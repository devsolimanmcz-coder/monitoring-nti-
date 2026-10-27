import { useCallback, useMemo, useState } from 'react'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
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
  return edges.map(({ id, source, target, label }) => ({
    id,
    source,
    target,
    ...(typeof label === 'string' && label ? { label } : {}),
  }))
}

export default function TopologyMap({
  nodes: initialNodes,
  connections,
  editable,
  height,
  onNodeMove,
  onConnectionsChange,
}) {
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState([])
  const nodes = useMemo(() => initialNodes.map((node) => ({
    ...node,
    selected: selectedNodeIds.includes(node.id),
  })), [initialNodes, selectedNodeIds])
  const edges = useMemo(() => connections.map((connection) => ({
    ...connection,
    type: 'smoothstep',
    animated: true,
    deletable: editable,
    selected: selectedEdgeIds.includes(connection.id),
    style: { stroke: edgeColor, strokeWidth: 2, strokeDasharray: '7 5' },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
  })), [connections, editable, selectedEdgeIds])

  const handleNodesChange = useCallback((changes) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        onNodeMove(change.id, change.position)
      }
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
      id: `${connection.source}-${connection.target}-${Date.now().toString(36)}`,
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

  return (
    <section className="topology-map" style={{ height }} aria-label="Mapa interativo de topologia de rede">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        nodesDraggable={editable}
        nodesConnectable={editable}
        nodesDeletable={false}
        edgesDeletable={editable}
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
