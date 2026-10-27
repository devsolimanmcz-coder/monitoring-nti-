import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

const edgeColor = '#38d6ff'

function TopologyWidgetNode({ data, selected }) {
  return (
    <div className={`topology-flow-node${selected ? ' selected' : ''}`}>
      {data.editable && <>
        <Handle className="topology-flow-handle" id="target-top" type="target" position={Position.Top} />
        <Handle className="topology-flow-handle" id="source-top" type="source" position={Position.Top} />
        <Handle className="topology-flow-handle" id="target-right" type="target" position={Position.Right} />
        <Handle className="topology-flow-handle" id="source-right" type="source" position={Position.Right} />
        <Handle className="topology-flow-handle" id="target-bottom" type="target" position={Position.Bottom} />
        <Handle className="topology-flow-handle" id="source-bottom" type="source" position={Position.Bottom} />
        <Handle className="topology-flow-handle" id="target-left" type="target" position={Position.Left} />
        <Handle className="topology-flow-handle" id="source-left" type="source" position={Position.Left} />
      </>}
      {data.content}
    </div>
  )
}

const nodeTypes = { topologyWidget: TopologyWidgetNode }

function persistableEdges(edges) {
  return edges.map(({ id, source, target, label, trafficItem }) => ({
    id,
    source,
    target,
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
  const [mapWidth, setMapWidth] = useState(1104)
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState([])
  const [positionOverrides, setPositionOverrides] = useState({})
  const nodeExtent = useMemo(() => [[0, 0], [mapWidth, 1_000_000]], [mapWidth])
  const nodes = useMemo(() => initialNodes.map((node) => {
    const override = positionOverrides[node.id]
    const canKeepLocalPosition = override
      && override.base.x === node.position.x
      && override.base.y === node.position.y
    return {
      ...node,
      position: canKeepLocalPosition ? override.position : node.position,
      selected: selectedNodeIds.includes(node.id),
    }
  }), [initialNodes, positionOverrides, selectedNodeIds])
  const selectedEdge = connections.find((connection) => selectedEdgeIds.includes(connection.id))
  const edges = useMemo(() => connections.map((connection) => {
    const traffic = connectionTraffic[connection.id]
    const label = traffic
      ? `${traffic.value === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(traffic.value)} Mbps`
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
      style: { stroke: edgeColor, strokeWidth: 2, strokeDasharray: '7 5' },
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
    }
  }), [connectionTraffic, connections, editable, selectedEdgeIds])

  const handleNodesChange = useCallback((changes) => {
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
  }, [initialNodes])

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
    const mapElement = mapRef.current
    if (!mapElement) return undefined

    const updateMapWidth = () => {
      const nextWidth = Math.floor(mapElement.clientWidth)
      setMapWidth((currentWidth) => currentWidth === nextWidth ? currentWidth : nextWidth)
    }

    updateMapWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMapWidth)
      return () => window.removeEventListener('resize', updateMapWidth)
    }

    const observer = new ResizeObserver(updateMapWidth)
    observer.observe(mapElement)
    return () => observer.disconnect()
  }, [])

  return (
    <section ref={mapRef} className="topology-map" style={{ height }} aria-label="Mapa interativo de topologia de rede">
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
        nodesDeletable={false}
        edgesDeletable={editable}
        elementsSelectable={editable}
        nodeExtent={nodeExtent}
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
          maskColor="rgba(4, 10, 18, .72)"
          pannable
          zoomable
        />
        <Controls className="topology-map-controls" showInteractive={false} />
      </ReactFlow>
    </section>
  )
}
