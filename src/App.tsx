import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  MAX_TUTORIAL_WARNINGS,
  checkFrontierValues,
  createInitialSession,
  expandCandidate,
  explainFValue,
  formatPath,
  generatePuzzle,
  getCorrectExpansionId,
  solvePuzzle,
  type AStarSolution,
  type InstanceId,
  type PlayMode,
  type Puzzle,
  type SearchSession,
} from './astar'

type HistoryFrame = {
  session: SearchSession
  inputs: Record<InstanceId, string>
  message: string
}

type AppState = {
  mode: PlayMode
  puzzle: Puzzle
  session: SearchSession
  inputs: Record<InstanceId, string>
  history: HistoryFrame[]
  message: string
}

const SAVE_KEY = 'astar-tree-trainer:v3'

const TREE_NODE_WIDTH = 58
const TREE_NODE_HEIGHT = 58
const TREE_HORIZONTAL_GAP = 34
const TREE_VERTICAL_GAP = 104
const TREE_PADDING = 30

function App() {
  const [state, setState] = useState<AppState>(() => readSavedState() ?? createFreshState('tutorial'))
  const treeScrollRef = useRef<HTMLDivElement | null>(null)
  const [treeViewportWidth, setTreeViewportWidth] = useState(0)
  const solution = useMemo(() => solvePuzzle(state.puzzle), [state.puzzle])
  const frontier = state.session.frontierIds.map((id) => state.session.nodes[id])
  const allFrontierValuesFilled = frontier.length > 0 && frontier.every((node) => (state.inputs[node.id]?.trim() ?? '').length > 0)
  const resultPath = state.session.status === 'playing' ? [] : solution.resultPath

  useEffect(() => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    const treeScroll = treeScrollRef.current
    if (!treeScroll) {
      return
    }

    const updateWidth = () => setTreeViewportWidth(treeScroll.clientWidth)
    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(treeScroll)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const treeScroll = treeScrollRef.current
    if (!treeScroll) {
      return
    }

    requestAnimationFrame(() => {
      if (treeScroll.scrollWidth > treeScroll.clientWidth) {
        treeScroll.scrollLeft = Math.max(0, (treeScroll.scrollWidth - treeScroll.clientWidth) / 2)
      }
      treeScroll.scrollTop = 0
    })
  }, [state.puzzle.id])

  function updateInput(id: InstanceId, rawValue: string) {
    const value = rawValue.replace(/[^0-9]/g, '')
    setState((current) => ({
      ...current,
      inputs: { ...current.inputs, [id]: value },
      message: '',
    }))
  }

  function handleExpand(id: InstanceId) {
    setState((current) => {
      if (current.session.status !== 'playing') {
        return current
      }

      const check = checkFrontierValues(current.session, current.inputs)
      if (check.missing.length > 0) {
        const missingLabels = check.missing.map((missingId) => formatPath(current.session.nodes[missingId].path)).join(', ')
        return {
          ...current,
          message: `Fill every visible f-value before expanding. Missing: ${missingLabels}.`,
        }
      }

      if (check.incorrect.length > 0) {
        const firstWrong = check.incorrect[0]
        const wrongNode = current.session.nodes[firstWrong.id]
        return applyMistake(current, {
          kind: 'f-value',
          at: formatPath(wrongNode.path),
          message: `${formatPath(wrongNode.path)} has f = ${firstWrong.expected}, not ${firstWrong.actual}. ${explainFValue(wrongNode, current.session.nodes)}.`,
        })
      }

      const correctId = getCorrectExpansionId(current.session)
      if (id !== correctId && correctId !== null) {
        const chosen = current.session.nodes[id]
        const correct = current.session.nodes[correctId]
        return applyMistake(current, {
          kind: 'expansion',
          at: formatPath(chosen.path),
          message: `Expand ${formatPath(correct.path)} first. It has the lowest f-value; ties go to the leftmost open path.`,
        })
      }

      const outcome = expandCandidate(current.session, id)
      const nextInputs = { ...current.inputs }
      delete nextInputs[id]
      for (const generatedId of outcome.generatedIds) {
        delete nextInputs[generatedId]
      }

      let nextSession = outcome.session
      let message = ''

      if (nextSession.status === 'won') {
        message = `Solved. Final path: ${formatPath(nextSession.nodes[nextSession.resultNodeId ?? id].path)}.`
      } else if (nextSession.frontierIds.length === 0) {
        nextSession = { ...nextSession, status: 'lost' }
        message = 'No open paths remain before a goal was expanded.'
      }

      return {
        ...current,
        session: nextSession,
        inputs: nextInputs,
        history: [...current.history, { session: current.session, inputs: current.inputs, message: current.message }],
        message,
      }
    })
  }

  function handleUndo() {
    setState((current) => {
      const previous = current.history[current.history.length - 1]
      if (!previous || current.session.status !== 'playing') {
        return current
      }

      return {
        ...current,
        session: previous.session,
        inputs: previous.inputs,
        message: previous.message || 'Reverted one expansion.',
        history: current.history.slice(0, -1),
      }
    })
  }

  function handleReveal() {
    setState((current) => {
      if (current.session.status !== 'playing') {
        return current
      }

      return {
        ...current,
        session: { ...current.session, status: 'revealed' },
        message: 'Solution revealed.',
      }
    })
  }

  function handleNewPuzzle(mode = state.mode) {
    setState(() => createFreshState(mode))
  }

  function handleModeChange(mode: PlayMode) {
    setState((current) => {
      if (current.mode === mode) {
        return current
      }

      return createFreshState(mode)
    })
  }

  return (
    <main className={`app-shell ${state.session.status}`}>
      <header className="hero-panel">
        <div>
          <h1>A* search tree practice</h1>
        </div>
        <div className="mode-card" aria-label="Current practice mode">
          <div className="mode-buttons">
            <button className={state.mode === 'tutorial' ? 'selected' : ''} type="button" onClick={() => handleModeChange('tutorial')}>
              <Icon name="guide" /> Tutorial
            </button>
            <button className={state.mode === 'regular' ? 'selected' : ''} type="button" onClick={() => handleModeChange('regular')}>
              <Icon name="bolt" /> Regular
            </button>
          </div>
        </div>
      </header>

      <section className="workspace">
        <div className="tree-card">
          <div className="section-heading">
            <div className="section-title">
              <span className="section-icon"><Icon name="tree" /></span>
              <div>
                <h2>Search tree</h2>
              </div>
            </div>
            {state.session.status !== 'playing' ? <span className={`state-pill ${state.session.status}`}>{state.session.status === 'won' ? 'finished' : state.session.status}</span> : null}
          </div>
          <div ref={treeScrollRef} className="tree-scroll" role="img" aria-label="Generated A star search tree">
            <TreeCanvas
              session={state.session}
              resultPath={resultPath}
              canExpand={allFrontierValuesFilled && state.session.status === 'playing'}
              onExpand={handleExpand}
              viewportWidth={treeViewportWidth}
            />
          </div>
        </div>

        <aside className="frontier-card">
          <div className="section-heading">
            <div className="section-title">
              <span className="section-icon"><Icon name="frontier" /></span>
              <div>
                <h2>Open paths</h2>
              </div>
            </div>
            <button type="button" className="secondary-action icon-button icon-only" aria-label="New tree" title="New tree" onClick={() => handleNewPuzzle()}>
              <Icon name="refresh" />
            </button>
          </div>

          <LifeMeter mode={state.mode} warningsUsed={state.session.warningsUsed} />

          <div className="frontier-list">
            {frontier.map((node) => (
              <article className="frontier-item" key={node.id}>
                <div>
                  <div className="path-line">{formatPath(node.path)}</div>
                </div>
                <label className="f-input">
                  <span>f</span>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={state.inputs[node.id] ?? ''}
                    disabled={state.session.status !== 'playing'}
                    onChange={(event) => updateInput(node.id, event.target.value)}
                    aria-label={`f value for ${formatPath(node.path)}`}
                  />
                </label>
              </article>
            ))}
          </div>

          <div className="action-row">
            <button type="button" className="secondary-action icon-button" disabled={state.history.length === 0 || state.session.status !== 'playing'} onClick={handleUndo}>
              <Icon name="undo" /> Undo
            </button>
            <button type="button" className="danger-action icon-button" disabled={state.session.status !== 'playing'} onClick={handleReveal}>
              <Icon name="eye" /> Reveal
            </button>
          </div>

          {state.message ? <p className="message-box">{state.message}</p> : null}

          <div className="rule-box">
            <strong>Rules</strong>
            <ul>
              <li>Fill every visible f-value before expanding.</li>
              <li>f = total path cost g + leaf heuristic h.</li>
              <li>Expand the lowest f; equal f uses the leftmost open path.</li>
              <li>Each label appears once in the tree; paths are unique branches.</li>
            </ul>
          </div>
        </aside>
      </section>

      {state.session.status !== 'playing' ? <SolutionPanel solution={solution} /> : <ProgressPanel session={state.session} />}
    </main>
  )
}

function applyMistake(state: AppState, mistake: { kind: 'f-value' | 'expansion'; at: string; message: string }): AppState {
  const mistakes = [...state.session.mistakes, mistake]

  if (state.mode === 'tutorial' && state.session.warningsUsed < MAX_TUTORIAL_WARNINGS) {
    const warningsUsed = state.session.warningsUsed + 1
    return {
      ...state,
      session: { ...state.session, warningsUsed, mistakes },
      message: `Warning ${warningsUsed}/${MAX_TUTORIAL_WARNINGS}: ${mistake.message}`,
    }
  }

  return {
    ...state,
    session: { ...state.session, status: 'lost', mistakes },
    message: `Lost: ${mistake.message}`,
  }
}

function createFreshState(mode: PlayMode): AppState {
  const puzzle = generatePuzzle()
  return {
    mode,
    puzzle,
    session: createInitialSession(puzzle),
    inputs: {},
    history: [],
    message: '',
  }
}

function readSavedState(): AppState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as AppState
    if (!parsed?.puzzle || !parsed?.session || !parsed?.session?.nodes) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

type IconName = 'mode' | 'guide' | 'bolt' | 'tree' | 'frontier' | 'refresh' | 'undo' | 'eye'

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    mode: 'M4 7h16M7 12h10M10 17h4',
    guide: 'M6 5.5A2.5 2.5 0 0 1 8.5 3H20v15H8.5A2.5 2.5 0 0 0 6 20.5v-15Zm0 0V20.5M10 7h6M10 10h5',
    bolt: 'm13 2-7 11h5l-1 9 7-12h-5l1-8Z',
    tree: 'M12 4v5m0 0H7v4m5-4h5v4M7 13v4m10-4v4M4 20h6M14 20h6',
    frontier: 'M4 7h8m-8 5h16M4 17h11M15 7h5',
    refresh: 'M20 6v5h-5M4 18v-5h5M18.5 10A7 7 0 0 0 6.1 6.8M5.5 14a7 7 0 0 0 12.4 3.2',
    undo: 'M9 8H4v5m0-5 5-5M5 13a7 7 0 1 0 2-5',
    eye: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Zm9.5 3.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
  }

  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

function LifeMeter({ mode, warningsUsed }: { mode: PlayMode; warningsUsed: number }) {
  const total = mode === 'tutorial' ? MAX_TUTORIAL_WARNINGS : 1
  const remaining = mode === 'tutorial' ? Math.max(0, MAX_TUTORIAL_WARNINGS - warningsUsed) : 1

  return (
    <div className="life-meter" aria-label={`${remaining} lives remaining`}>
      <span>Lives</span>
      <div className="life-dots">
        {Array.from({ length: total }, (_, index) => (
          <span className={index < remaining ? 'life-dot active' : 'life-dot'} key={index} />
        ))}
      </div>
    </div>
  )
}

type TreeMeasure = {
  id: InstanceId
  width: number
  children: TreeMeasure[]
}

type TreeLayout = {
  width: number
  height: number
  nodes: Record<InstanceId, { centerX: number; top: number }>
  edges: Array<{ from: InstanceId; to: InstanceId; cost: number }>
}

function TreeCanvas({
  session,
  resultPath,
  canExpand,
  onExpand,
  viewportWidth,
}: {
  session: SearchSession
  resultPath: string[]
  canExpand: boolean
  onExpand: (id: InstanceId) => void
  viewportWidth: number
}) {
  const layout = useMemo(() => createTreeLayout(session), [session])
  const shouldFitTree = viewportWidth > 0 && viewportWidth < 620
  const availableWidth = shouldFitTree ? Math.max(240, viewportWidth - 24) : layout.width
  const scale = shouldFitTree ? Math.min(1, availableWidth / layout.width) : 1

  return (
    <div className="tree-canvas-frame" style={{ width: layout.width * scale, height: layout.height * scale }}>
      <div className="tree-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
      <svg className="tree-connectors" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
        {layout.edges.map((edge) => {
          const from = layout.nodes[edge.from]
          const to = layout.nodes[edge.to]
          const startY = from.top + TREE_NODE_HEIGHT + 8
          const endY = to.top - 8
          const midY = startY + (endY - startY) * 0.52
          const path = `M ${from.centerX} ${startY} C ${from.centerX} ${midY}, ${to.centerX} ${midY}, ${to.centerX} ${endY}`

          return <path className="tree-edge" d={path} key={`${edge.from}-${edge.to}`} />
        })}
      </svg>

      {layout.edges.map((edge) => {
        const from = layout.nodes[edge.from]
        const to = layout.nodes[edge.to]
        const x = from.centerX + (to.centerX - from.centerX) * 0.5
        const y = from.top + TREE_NODE_HEIGHT + (to.top - from.top - TREE_NODE_HEIGHT) * 0.48

        return (
          <span className="edge-label" key={`label-${edge.from}-${edge.to}`} style={{ left: x, top: y }}>
            +{edge.cost}
          </span>
        )
      })}

      {Object.values(session.nodes).map((node) => {
        const position = layout.nodes[node.id]
        const isOnResultPath = resultPath.length > 0 && node.path.every((stateId, index) => resultPath[index] === stateId)
        const classNames = ['tree-node', node.status, node.isGoal ? 'goal-node' : '', isOnResultPath ? 'result-path' : '', node.status === 'frontier' && canExpand ? 'ready' : '']
          .filter(Boolean)
          .join(' ')
        const style = {
          left: position.centerX - TREE_NODE_WIDTH / 2,
          top: position.top,
        }
        const body = (
          <>
            <span className="node-id">{node.stateId}</span>
            <span className="node-h">h={node.h}</span>
            {node.isGoal ? <span className="goal-badge">goal</span> : null}
          </>
        )

        if (node.status === 'frontier') {
          return (
            <button
              type="button"
              className={`${classNames} tree-node-button`}
              disabled={!canExpand}
              onClick={() => onExpand(node.id)}
              aria-label={`Expand ${formatPath(node.path)}`}
              key={node.id}
              style={style}
            >
              {body}
            </button>
          )
        }

        return (
          <div className={classNames} key={node.id} style={style}>
            {body}
          </div>
        )
      })}
      </div>
    </div>
  )
}

function createTreeLayout(session: SearchSession): TreeLayout {
  const rootMeasure = measureTree(session.rootId, session)
  const nodes: TreeLayout['nodes'] = {}
  const edges: TreeLayout['edges'] = []
  let maxDepth = 0

  const assign = (measure: TreeMeasure, left: number, depth: number) => {
    const centerX = left + measure.width / 2
    const top = TREE_PADDING + depth * TREE_VERTICAL_GAP
    nodes[measure.id] = { centerX, top }
    maxDepth = Math.max(maxDepth, depth)

    if (measure.children.length === 0) {
      return
    }

    const childrenWidth =
      measure.children.reduce((sum, child) => sum + child.width, 0) + TREE_HORIZONTAL_GAP * (measure.children.length - 1)
    let childLeft = left + (measure.width - childrenWidth) / 2

    for (const childMeasure of measure.children) {
      const child = session.nodes[childMeasure.id]
      edges.push({ from: measure.id, to: childMeasure.id, cost: child.edgeCost })
      assign(childMeasure, childLeft, depth + 1)
      childLeft += childMeasure.width + TREE_HORIZONTAL_GAP
    }
  }

  assign(rootMeasure, TREE_PADDING, 0)

  return {
    width: rootMeasure.width + TREE_PADDING * 2,
    height: TREE_PADDING * 2 + maxDepth * TREE_VERTICAL_GAP + TREE_NODE_HEIGHT,
    nodes,
    edges,
  }
}

function measureTree(id: InstanceId, session: SearchSession): TreeMeasure {
  const children = session.nodes[id].childIds.map((childId) => measureTree(childId, session))

  if (children.length === 0) {
    return { id, width: TREE_NODE_WIDTH, children }
  }

  const childrenWidth = children.reduce((sum, child) => sum + child.width, 0) + TREE_HORIZONTAL_GAP * (children.length - 1)
  return { id, width: Math.max(TREE_NODE_WIDTH, childrenWidth), children }
}

function ProgressPanel({ session }: { session: SearchSession }) {
  return (
    <section className="review-panel compact-panel">
      <div className="section-heading">
        <div>
          <h2>Expanded so far</h2>
        </div>
      </div>
      {session.expandedIds.length === 0 ? (
        <p className="empty-note">Nothing expanded yet.</p>
      ) : (
        <ol className="review-list">
          {session.expandedIds.map((id) => {
            const node = session.nodes[id]
            return (
              <li key={id}>
                <span>{formatPath(node.path)}</span>
                <strong>f={node.f}</strong>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function SolutionPanel({ solution }: { solution: AStarSolution }) {
  if (solution.status !== 'solved') {
    return (
      <section className="review-panel">
        <h2>Solution unavailable</h2>
        <p>The generated tree did not produce a valid A* solution. Start a new tree.</p>
      </section>
    )
  }

  return (
    <section className="review-panel solution-panel">
      <div className="section-heading">
        <div>
          <h2>Correct solution</h2>
          <p>
            Final path: <strong>{formatPath(solution.resultPath)}</strong> · cost {solution.resultCost}
          </p>
        </div>
      </div>
      <ol className="review-list">
        {solution.expansionOrder.map((node, index) => (
          <li key={`${node.id}-${index}`}>
            <span>
              {index + 1}. {formatPath(node.path)}
            </span>
            <strong>f={node.f}</strong>
          </li>
        ))}
      </ol>
      <div className="step-review">
        {solution.steps.map((step) => (
          <article key={step.index}>
            <h3>Step {step.index + 1}: expand {formatPath(step.expanded.path)}</h3>
            <p>Open before expansion: {step.frontier.map((item) => `${formatPath(item.path)} f=${item.f}`).join(' · ')}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default App
