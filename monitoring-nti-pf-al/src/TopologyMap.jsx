import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react'
import { getConnectionHealth } from './connection-traffic.js'
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

function persistableEdges(edges) {
  return edges.map(({ id, source, target, sourceHandle, targetHandle, label, trafficItem }) => ({
    id,
    source,
    target,
    ...(typeof sourceHandle === 'string' ? { sourceHandle } : {}),
    ...(typeof targetHandle === 'string' ? { targetHandle } : {}),
    ...(typeof label === 'string' && label ? { label } : {}),
    ...(trafficItem ? { trafficItem } : {}),
  }))
}

export default function TopologyMap({
  nodes: initialNodes,
  connections,
  connectionTraffic = {},
  editable,
  height,
  onNodeMove,
  onConfigureNode,
  onConnectionsChange,
  onConfigureConnection,
}) {
  const mapRef = useRef(null)
  const flowRef = useRef(null)
  const previousGeometryRef = useRef(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState([])
  const [positionOverrides, setPositionOverrides] = useState({})
  const [nodeDimensions, setNodeDimensions] = useState({})
  const geometryKey = JSON.stringify(initialNodes.map(({ id, position, style }) => [
    id,
    position.x,
    position.y,
    style?.width,
    style?.height,
  ]))
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
    const label = traffic
      ? `${traffic.direction ? `${traffic.direction} · ` : ''}${traffic.value === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(traffic.value)} Mbps`
      : connection.label
    return {
      ...connection,
      label,
      labelStyle: { fill: '#eaf7ff', fontSize: 12, fontWeight: 700 },
      labelBgStyle: { fill: '#0b1724', fillOpacity: 0.94 },
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 6,
      labelShowBg: Boolean(label),
      ariaLabel: traffic?.title || connection.label || 'Conexão de rede',
      type: 'smoothstep',
      animated: true,
      deletable: editable,
      selected: selectedEdgeIds.includes(connection.id),
      style: { stroke: health?.color || edgeColor, strokeWidth: 2, strokeDasharray: '7 5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: health?.color || edgeColor },
    }
  }), [connectionTraffic, connections, editable, nodes, selectedEdgeIds])

  const fitViewIfNodesAreOutsideMap = useCallback(() => {
    const mapElement = mapRef.current
    const flow = flowRef.current
    if (!mapElement || !flow) return

    const { x, y, zoom } = flow.getViewport()
    const hasNodeOutsideMap = flow.getNodes().some((node) => {
      const width = (node.measured?.width ?? node.width ?? 0) * zoom
      const height = (node.measured?.height ?? node.height ?? 0) * zoom
      const left = node.position.x * zoom + x
      const top = node.position.y * zoom + y
      return left < 0
        || top < 0
        || left + width > mapElement.clientWidth
        || top + height > mapElement.clientHeight
    })

    if (hasNodeOutsideMap) flow.fitView({ padding: 0.18, maxZoom: 1 })
  }, [])

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
      setPositionOverrides((current) => {
        const next = { ...current }
        for (const change of positionChanges) {
          const base = positionsById.get(change.id)
          if (base) next[change.id] = { base, position: change.position }
        }
        return next
      })
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
    onNodeMove(node.id, node.position)
  }, [onNodeMove])

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
      style: { stroke: edgeColor, strokeWidth: 2, strokeDasharray: '7 5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
    }, edges)
    onConnectionsChange(persistableEdges(nextEdges))
  }, [edges, onConnectionsChange])

  const defaultEdgeOptions = useMemo(() => ({
    type: 'smoothstep',
    animated: true,
    deletable: editable,
    style: { stroke: edgeColor, strokeWidth: 2, strokeDasharray: '7 5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
  }), [editable])

  useEffect(() => {
    const previousGeometry = previousGeometryRef.current
    previousGeometryRef.current = geometryKey
    if (previousGeometry === null || previousGeometry === geometryKey) return undefined

    const frame = window.requestAnimationFrame(fitViewIfNodesAreOutsideMap)
    return () => window.cancelAnimationFrame(frame)
  }, [fitViewIfNodesAreOutsideMap, geometryKey])

  return (
    <section ref={mapRef} className="topology-map" style={{ height }} aria-label="Mapa interativo de topologia de rede">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={(flow) => { flowRef.current = flow }}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
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
        {editable && selectedEdge && <Panel position="top-right" className="topology-connection-toolbar nodrag nopan">
          <span>{connectionTraffic[selectedEdge.id]?.title || 'Enlace selecionado'}</span>
          <button type="button" className="edit-panel-button" onClick={() => onConfigureConnection(selectedEdge)}>
            {selectedEdge.trafficItem ? 'Configurar tráfego' : 'Configurar Mbps'}
          </button>
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
