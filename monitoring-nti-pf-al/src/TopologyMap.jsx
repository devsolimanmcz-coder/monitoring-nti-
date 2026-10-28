import { useCallback, useMemo, useState } from 'react'
import {
  addEdge,
  applyNodeChanges,
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useStore,
} from '@xyflow/react'
import { getConnectionHealth } from './connection-traffic.js'
import { getSnappedNodePosition } from './topology-alignment.js'
import '@xyflow/react/dist/style.css'

const edgeColor = '#38d6ff'

function TopologyWidgetNode({ data, selected }) {
  return (
    <div className={`topology-flow-node${selected ? ' selected' : ''}${data.editable ? '' : ' topology-flow-node-readonly'}`}>
      <Handle className="topology-flow-handle" id="target-top" type="target" position={Position.Top} />
      <Handle className="topology-flow-handle" id="source-top" type="source" position={Position.Top} />
      <Handle className="topology-flow-handle" id="target-right" type="target" position={Position.Right} />
      <Handle className="topology-flow-handle" id="source-right" type="source" position={Position.Right} />
      <Handle className="topology-flow-handle" id="target-bottom" type="target" position={Position.Bottom} />
      <Handle className="topology-flow-handle" id="source-bottom" type="source" position={Position.Bottom} />
      <Handle className="topology-flow-handle" id="target-left" type="target" position={Position.Left} />
      <Handle className="topology-flow-handle" id="source-left" type="source" position={Position.Left} />
      {data.content}
    </div>
  )
}

const nodeTypes = { topologyWidget: TopologyWidgetNode }

function TopologyTrafficEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  data,
}) {
  const pathOptions = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }
  const [path, labelX, labelY] = data.edgeStyle === 'straight'
    ? getStraightPath(pathOptions)
    : data.edgeStyle === 'bezier'
      ? getBezierPath(pathOptions)
      : getSmoothStepPath(pathOptions)

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data.trafficLabels.length > 0 && <EdgeLabelRenderer>
        <div
          className="topology-edge-labels nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          aria-label={data.trafficLabels.join(', ')}
        >
          {data.trafficLabels.map((label) => <span className="topology-edge-label" key={label}>{label}</span>)}
        </div>
      </EdgeLabelRenderer>}
    </>
  )
}

const edgeTypes = { topologyTraffic: TopologyTrafficEdge }

function AlignmentGuides({ guides }) {
  const [x, y, zoom] = useStore((state) => state.transform)

  if (guides.x === null && guides.y === null) return null

  return (
    <svg className="topology-alignment-guides" aria-hidden="true">
      {guides.x !== null && <line x1={x + guides.x * zoom} x2={x + guides.x * zoom} y1="0" y2="100%" />}
      {guides.y !== null && <line x1="0" x2="100%" y1={y + guides.y * zoom} y2={y + guides.y * zoom} />}
    </svg>
  )
}

function persistableEdges(edges) {
  return edges.map(({ id, source, target, sourceHandle, targetHandle, label, trafficItem, trafficItems, healthyColor, edgeStyle }) => ({
    id,
    source,
    target,
    ...(typeof sourceHandle === 'string' ? { sourceHandle } : {}),
    ...(typeof targetHandle === 'string' ? { targetHandle } : {}),
    ...(typeof label === 'string' && label ? { label } : {}),
    ...(trafficItem ? { trafficItem } : {}),
    ...(trafficItems ? { trafficItems } : {}),
    ...(healthyColor ? { healthyColor } : {}),
    ...(edgeStyle ? { edgeStyle } : {}),
  }))
}

export default function TopologyMap({
  nodes: initialNodes,
  connections,
  connectionTraffic = {},
  editable,
  height,
  kioskMode = false,
  kioskMapHeight = 65,
  onNodeMove,
  onConfigureNode,
  onConnectionsChange,
  onConfigureConnection,
}) {
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState([])
  const [positionOverrides, setPositionOverrides] = useState({})
  const [nodeDimensions, setNodeDimensions] = useState({})
  const [alignmentGuides, setAlignmentGuides] = useState({ x: null, y: null })
  const nodes = useMemo(() => initialNodes.map((node) => {
    const override = positionOverrides[node.id]
    const canKeepLocalPosition = override
      && override.base.x === node.position.x
      && override.base.y === node.position.y
    return {
      ...node,
      ...nodeDimensions[node.id],
      position: canKeepLocalPosition ? override.position : node.position,
      selected: selectedNodeIds.includes(node.id),
      deletable: false,
    }
  }), [initialNodes, nodeDimensions, positionOverrides, selectedNodeIds])
  const selectedEdge = connections.find((connection) => selectedEdgeIds.includes(connection.id))
  const edges = useMemo(() => connections.map((connection) => {
    const traffic = connectionTraffic[connection.id]
    const sourceState = nodes.find((node) => node.id === connection.source)?.data.availability?.state
    const targetState = nodes.find((node) => node.id === connection.target)?.data.availability?.state
    const health = getConnectionHealth(sourceState, targetState, connection.healthyColor)
    const trafficLabels = traffic
      ? Object.entries(traffic)
        .filter(([, value]) => value)
        .map(([direction, value]) => `${direction === 'received' ? 'RECEBIDO' : 'ENVIADO'} · ${value.value === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value.value)} Mbps`)
      : []
    const hasTrafficLabels = trafficLabels.length > 0
    const healthColor = health.color
    return {
      ...connection,
      label: hasTrafficLabels ? undefined : connection.label,
      data: {
        ...connection.data,
        edgeStyle: connection.edgeStyle || 'smoothstep',
        trafficLabels,
      },
      labelStyle: { fill: '#eaf7ff', fontSize: 12, fontWeight: 700 },
      labelBgStyle: { fill: '#0b1724', fillOpacity: 0.94 },
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 6,
      labelShowBg: Boolean(connection.label && !hasTrafficLabels),
      ariaLabel: Object.values(traffic || {}).map((item) => item.title).filter(Boolean).join(' | ')
        || connection.label
        || 'Conexão de rede',
      type: hasTrafficLabels ? 'topologyTraffic' : connection.edgeStyle || 'smoothstep',
      animated: true,
      deletable: editable,
      selected: selectedEdgeIds.includes(connection.id),
      style: { stroke: healthColor, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: healthColor },
    }
  }), [connectionTraffic, connections, editable, nodes, selectedEdgeIds])

  const handleNodesChange = useCallback((changes) => {
    const dimensionChanges = changes.filter((change) => change.type === 'dimensions')
    if (dimensionChanges.length) {
      const changedNodes = applyNodeChanges(dimensionChanges, nodes)
      setNodeDimensions((current) => {
        const next = { ...current }
        for (const change of dimensionChanges) {
          const node = changedNodes.find((item) => item.id === change.id)
          if (node) {
            next[node.id] = {
              measured: node.measured,
              ...(node.width !== undefined ? { width: node.width } : {}),
              ...(node.height !== undefined ? { height: node.height } : {}),
            }
          }
        }
        return next
      })
    }
    const positionChanges = changes.filter((change) => change.type === 'position' && change.position)
    if (positionChanges.length) {
      const positionsById = new Map(initialNodes.map((node) => [node.id, node.position]))
      const activeChange = positionChanges.find((change) => change.dragging)
      const activeNode = activeChange && nodes.find((node) => node.id === activeChange.id)
      const alignment = activeNode
        ? getSnappedNodePosition(activeNode, activeChange.position, nodes)
        : null
      setPositionOverrides((current) => {
        const next = { ...current }
        for (const change of positionChanges) {
          const base = positionsById.get(change.id)
          if (base) next[change.id] = {
            base,
            position: change.id === activeNode?.id && alignment ? alignment.position : change.position,
          }
        }
        return next
      })
      if (activeNode && alignment) setAlignmentGuides(alignment.guides)
    }
    const selectionChanges = changes.filter((change) => change.type === 'select')
    if (selectionChanges.length) {
      setSelectedNodeIds((current) => {
        const selected = new Set(current)
        for (const change of selectionChanges) {
          if (change.selected) selected.add(change.id)
          else selected.delete(change.id)
        }
        return [...selected]
      })
    }
  }, [initialNodes, nodes])

  const handleNodeDragStop = useCallback((_event, node) => {
    const { position } = getSnappedNodePosition(node, node.position, nodes)
    setPositionOverrides((current) => ({
      ...current,
      [node.id]: {
        base: initialNodes.find((item) => item.id === node.id)?.position || position,
        position,
      },
    }))
    onNodeMove(node.id, position)
    setAlignmentGuides({ x: null, y: null })
  }, [initialNodes, nodes, onNodeMove])

  const handleEdgesChange = useCallback((changes) => {
    const selectionChanges = changes.filter((change) => change.type === 'select')
    if (selectionChanges.length) {
      setSelectedEdgeIds((current) => {
        const selected = new Set(current)
        for (const change of selectionChanges) {
          if (change.selected) selected.add(change.id)
          else selected.delete(change.id)
        }
        return [...selected]
      })
    }
    const removedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id))
    if (removedIds.size) {
      onConnectionsChange(connections.filter((edge) => !removedIds.has(edge.id)))
    }
  }, [connections, onConnectionsChange])

  const handleConnect = useCallback((connection) => {
    const nextEdges = addEdge({
      ...connection,
      id: globalThis.crypto?.randomUUID?.() || `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      type: 'smoothstep',
      animated: true,
      style: { stroke: edgeColor, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
    }, edges)
    onConnectionsChange(persistableEdges(nextEdges))
  }, [edges, onConnectionsChange])

  const defaultEdgeOptions = useMemo(() => ({
    type: 'smoothstep',
    animated: true,
    deletable: editable,
    style: { stroke: edgeColor, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
  }), [editable])

  return (
    <section
      className={`topology-map${kioskMode ? ' topology-map-kiosk' : ''}`}
      style={kioskMode ? { height: `${kioskMapHeight}vh`, minHeight: 320 } : { height }}
      aria-label="Mapa interativo de topologia de rede"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeDrag={(_event, node) => {
          const { guides } = getSnappedNodePosition(node, node.position, nodes)
          setAlignmentGuides(guides)
        }}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(event, node) => {
          if (!editable || !node.data.widget) return
          if (event.target instanceof Element && event.target.closest('.widget-controls, .widget-resize-handle, .topology-flow-handle')) return
          onConfigureNode(node.data.widget)
        }}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onEdgeClick={(_event, edge) => setSelectedEdgeIds([edge.id])}
        onPaneClick={() => setSelectedEdgeIds([])}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        deleteKeyCode={editable ? ['Backspace', 'Delete'] : null}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        minZoom={0.15}
        maxZoom={1.5}
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        panOnDrag
        zoomOnScroll
      >
        <AlignmentGuides guides={alignmentGuides} />
        {editable && selectedEdge && <Panel position="top-right" className="topology-connection-toolbar nodrag nopan">
          <span>{Object.values(connectionTraffic[selectedEdge.id] || {}).map((item) => item.title).filter(Boolean).join(' | ') || 'Ligação selecionada'}</span>
          <button type="button" className="edit-panel-button" onClick={() => onConfigureConnection(selectedEdge)}>
            {selectedEdge.trafficItems || selectedEdge.trafficItem ? 'Configurar tráfego' : 'Configurar Mbps'}
          </button>
          <button type="button" className="edit-panel-button topology-connection-delete" onClick={() => {
            onConnectionsChange(connections.filter((connection) => connection.id !== selectedEdge.id))
            setSelectedEdgeIds([])
          }}>Remover ligação</button>
        </Panel>}
        <Background color="rgba(90, 160, 205, .18)" gap={24} size={1} />
        <MiniMap
          className="topology-minimap"
          nodeColor={(node) => node.data?.isHost ? '#80dc63' : '#58baff'}
          nodeStrokeColor={(node) => node.data?.isHost ? '#c2ff76' : '#a6e5ff'}
          nodeStrokeWidth={2}
          maskColor="rgba(4, 10, 18, .35)"
          pannable
          zoomable
        />
        <Controls className="topology-map-controls" showInteractive={false} />
      </ReactFlow>
    </section>
  )
}
