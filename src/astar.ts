export type StateId = string
export type InstanceId = string
export type PlayMode = 'tutorial' | 'regular'

export const MAX_TUTORIAL_WARNINGS = 3

export type GraphNode = {
  id: StateId
  h: number
  isGoal: boolean
}

export type GraphEdge = {
  from: StateId
  to: StateId
  cost: number
}

export type Puzzle = {
  id: string
  seed: number
  start: StateId
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type SearchNodeStatus = 'unopened' | 'frontier' | 'expanded'

export type SearchNode = {
  id: InstanceId
  stateId: StateId
  parentId: InstanceId | null
  edgeCost: number
  g: number
  h: number
  f: number
  generatedIndex: number
  path: StateId[]
  childIds: InstanceId[]
  status: SearchNodeStatus
  isGoal: boolean
}

export type Mistake = {
  kind: 'f-value' | 'expansion'
  message: string
  at: string
}

export type SearchSession = {
  rootId: InstanceId
  nodes: Record<InstanceId, SearchNode>
  frontierIds: InstanceId[]
  expandedIds: InstanceId[]
  status: 'playing' | 'won' | 'lost' | 'revealed'
  resultNodeId: InstanceId | null
  warningsUsed: number
  mistakes: Mistake[]
}

export type FrontierSnapshot = {
  id: InstanceId
  stateId: StateId
  path: StateId[]
  g: number
  h: number
  f: number
  isGoal: boolean
}

export type AStarStep = {
  index: number
  frontier: FrontierSnapshot[]
  expanded: FrontierSnapshot
  generated: FrontierSnapshot[]
}

export type AStarSolution = {
  status: 'solved' | 'failed'
  steps: AStarStep[]
  expansionOrder: FrontierSnapshot[]
  resultNodeId: InstanceId | null
  resultPath: StateId[]
  resultCost: number | null
  maxFrontier: number
  treeNodeCount: number
  tieSteps: number
  selectedNonFirstCount: number
}

export type FValueCheck = {
  missing: InstanceId[]
  incorrect: Array<{
    id: InstanceId
    expected: number
    actual: string
  }>
}

type TreeTemplate = {
  name: string
  edges: Array<[StateId, StateId]>
}

type VisibleTreeBuild = {
  rootId: InstanceId
  nodes: Record<InstanceId, SearchNode>
}

const START_NODE: StateId = 'a'
const STATE_IDS: StateId[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
const TREE_TEMPLATES: TreeTemplate[] = [
  {
    name: 'balanced-eleven',
    edges: [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['b', 'e'],
      ['c', 'f'],
      ['c', 'g'],
      ['d', 'h'],
      ['d', 'i'],
      ['e', 'j'],
      ['g', 'k'],
    ],
  },
  {
    name: 'wide-middle',
    edges: [
      ['a', 'b'],
      ['a', 'c'],
      ['a', 'd'],
      ['b', 'e'],
      ['b', 'f'],
      ['c', 'g'],
      ['d', 'h'],
      ['d', 'i'],
      ['g', 'j'],
      ['g', 'k'],
    ],
  },
  {
    name: 'deep-left',
    edges: [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['b', 'e'],
      ['c', 'f'],
      ['c', 'g'],
      ['d', 'h'],
      ['e', 'i'],
      ['e', 'j'],
      ['f', 'k'],
    ],
  },
  {
    name: 'exam-compact',
    edges: [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['b', 'e'],
      ['b', 'f'],
      ['c', 'g'],
      ['c', 'h'],
      ['d', 'i'],
      ['e', 'j'],
      ['h', 'k'],
    ],
  },
]

export function createSeed(): number {
  const values = new Uint32Array(1)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
    return values[0] || 1
  }

  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

export function generatePuzzle(seed = createSeed()): Puzzle {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const candidateSeed = (seed + Math.imul(attempt + 1, 0x9e3779b9)) >>> 0
    const puzzle = buildCandidatePuzzle(seed, candidateSeed, attempt)
    const solution = solvePuzzle(puzzle)

    if (isGoodPracticePuzzle(solution)) {
      return puzzle
    }
  }

  return createFallbackPuzzle(seed)
}

export function createInitialSession(puzzle: Puzzle): SearchSession {
  const visibleTree = buildVisibleTree(puzzle)
  const root = visibleTree.nodes[visibleTree.rootId]

  return {
    rootId: visibleTree.rootId,
    nodes: {
      ...visibleTree.nodes,
      [visibleTree.rootId]: { ...root, status: 'frontier' },
    },
    frontierIds: [visibleTree.rootId],
    expandedIds: [],
    status: 'playing',
    resultNodeId: null,
    warningsUsed: 0,
    mistakes: [],
  }
}

export function expandCandidate(
  session: SearchSession,
  nodeId: InstanceId,
): { session: SearchSession; generatedIds: InstanceId[] } {
  const selected = session.nodes[nodeId]

  if (!selected) {
    throw new Error(`Unknown search node: ${nodeId}`)
  }

  if (!session.frontierIds.includes(nodeId)) {
    throw new Error(`Node is not in the frontier: ${nodeId}`)
  }

  const nodes: Record<InstanceId, SearchNode> = {
    ...session.nodes,
    [nodeId]: { ...selected, status: 'expanded' },
  }
  const generatedIds = selected.isGoal ? [] : selected.childIds
  let resultNodeId = session.resultNodeId
  let status = session.status

  if (selected.isGoal) {
    status = 'won'
    resultNodeId = selected.id
  } else {
    for (const childId of generatedIds) {
      nodes[childId] = { ...nodes[childId], status: 'frontier' }
    }
  }

  const frontierIndex = session.frontierIds.indexOf(nodeId)
  const frontierIds = [
    ...session.frontierIds.slice(0, frontierIndex),
    ...generatedIds,
    ...session.frontierIds.slice(frontierIndex + 1),
  ]

  return {
    generatedIds,
    session: {
      ...session,
      nodes,
      frontierIds,
      expandedIds: [...session.expandedIds, nodeId],
      status,
      resultNodeId,
    },
  }
}

export function getCorrectExpansionId(session: SearchSession): InstanceId | null {
  let bestId: InstanceId | null = null
  let bestF = Number.POSITIVE_INFINITY

  for (const id of session.frontierIds) {
    const node = session.nodes[id]
    if (node.f < bestF) {
      bestF = node.f
      bestId = id
    }
  }

  return bestId
}

export function checkFrontierValues(
  session: SearchSession,
  inputs: Record<InstanceId, string>,
): FValueCheck {
  const missing: InstanceId[] = []
  const incorrect: FValueCheck['incorrect'] = []

  for (const id of session.frontierIds) {
    const raw = inputs[id]?.trim() ?? ''

    if (raw.length === 0) {
      missing.push(id)
      continue
    }

    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed !== session.nodes[id].f) {
      incorrect.push({ id, expected: session.nodes[id].f, actual: raw })
    }
  }

  return { missing, incorrect }
}

export function solvePuzzle(puzzle: Puzzle): AStarSolution {
  let session = createInitialSession(puzzle)
  const steps: AStarStep[] = []
  const expansionOrder: FrontierSnapshot[] = []
  let maxFrontier = 1
  let tieSteps = 0
  let selectedNonFirstCount = 0

  for (let index = 0; index < 64; index += 1) {
    if (session.frontierIds.length === 0) {
      return failedSolution(session, steps, expansionOrder, maxFrontier, tieSteps, selectedNonFirstCount)
    }

    maxFrontier = Math.max(maxFrontier, session.frontierIds.length)
    const correctId = getCorrectExpansionId(session)
    if (!correctId) {
      return failedSolution(session, steps, expansionOrder, maxFrontier, tieSteps, selectedNonFirstCount)
    }

    const frontier = session.frontierIds.map((id) => snapshot(session.nodes[id]))
    const minF = session.nodes[correctId].f
    const matchingMin = frontier.filter((item) => item.f === minF).length
    if (matchingMin > 1) {
      tieSteps += 1
    }

    if (session.frontierIds.indexOf(correctId) > 0) {
      selectedNonFirstCount += 1
    }

    const expanded = snapshot(session.nodes[correctId])
    const outcome = expandCandidate(session, correctId)
    session = outcome.session

    steps.push({
      index,
      frontier,
      expanded,
      generated: outcome.generatedIds.map((id) => snapshot(session.nodes[id])),
    })
    expansionOrder.push(expanded)

    if (session.status === 'won' && session.resultNodeId) {
      const result = session.nodes[session.resultNodeId]
      return {
        status: 'solved',
        steps,
        expansionOrder,
        resultNodeId: session.resultNodeId,
        resultPath: result.path,
        resultCost: result.g,
        maxFrontier,
        treeNodeCount: Object.keys(session.nodes).length,
        tieSteps,
        selectedNonFirstCount,
      }
    }
  }

  return failedSolution(session, steps, expansionOrder, maxFrontier, tieSteps, selectedNonFirstCount)
}

export function formatPath(path: StateId[]): string {
  return path.join(' → ')
}

export function getPathCostParts(node: SearchNode, nodes: Record<InstanceId, SearchNode>): number[] {
  const parts: number[] = []
  let current: SearchNode | undefined = node

  while (current?.parentId) {
    parts.push(current.edgeCost)
    current = nodes[current.parentId]
  }

  return parts.reverse()
}

export function explainFValue(node: SearchNode, nodes: Record<InstanceId, SearchNode>): string {
  const costs = getPathCostParts(node, nodes)
  const gFormula = costs.length > 0 ? costs.join(' + ') : '0'
  return `g = ${gFormula} = ${node.g}; h(${node.stateId}) = ${node.h}; f = ${node.g} + ${node.h} = ${node.f}`
}

function buildVisibleTree(puzzle: Puzzle): VisibleTreeBuild {
  const nodes: Record<InstanceId, SearchNode> = {}
  let generatedIndex = 0

  const createTreeNode = (stateId: StateId, parentId: InstanceId | null, edgeCost: number, g: number, path: StateId[]): InstanceId => {
    const graphNode = getNode(puzzle, stateId)
    const id = `n${generatedIndex}`
    const currentIndex = generatedIndex
    generatedIndex += 1
    const childIds: InstanceId[] = []

    nodes[id] = {
      id,
      stateId,
      parentId,
      edgeCost,
      g,
      h: graphNode.h,
      f: g + graphNode.h,
      generatedIndex: currentIndex,
      path,
      childIds,
      status: 'unopened',
      isGoal: graphNode.isGoal,
    }

    for (const edge of getSuccessors(puzzle, stateId)) {
      childIds.push(createTreeNode(edge.to, id, edge.cost, g + edge.cost, [...path, edge.to]))
    }

    nodes[id] = { ...nodes[id], childIds }
    return id
  }

  const rootId = createTreeNode(puzzle.start, null, 0, 0, [puzzle.start])
  return { rootId, nodes }
}

function buildCandidatePuzzle(originalSeed: number, seed: number, attempt: number): Puzzle {
  const rng = makeRng(seed)
  const template = TREE_TEMPLATES[randInt(rng, 0, TREE_TEMPLATES.length - 1)]
  const edges = template.edges
    .map(([from, to]) => ({ from, to, cost: randInt(rng, 1, 9) }))
    .sort(compareEdges)
  const nodeIds = STATE_IDS.filter((id) => id === START_NODE || edges.some((edge) => edge.from === id || edge.to === id))
  const leaves = nodeIds.filter((id) => !edges.some((edge) => edge.from === id) && id !== START_NODE)
  const shuffledLeaves = [...leaves]

  for (let index = shuffledLeaves.length - 1; index > 0; index -= 1) {
    const swapIndex = randInt(rng, 0, index)
    const held = shuffledLeaves[index]
    shuffledLeaves[index] = shuffledLeaves[swapIndex]
    shuffledLeaves[swapIndex] = held
  }

  const goalCount = Math.min(shuffledLeaves.length, randInt(rng, 3, 4))
  const goals = new Set(shuffledLeaves.slice(0, goalCount))
  const minGoalCosts = computeMinGoalCosts([...goals], edges, nodeIds)
  const nodes = nodeIds.map((id) => {
    if (goals.has(id)) {
      return { id, h: 0, isGoal: true }
    }

    const trueDistance = minGoalCosts.get(id)
    const cap = Number.isFinite(trueDistance) ? Math.max(3, Math.min(8, Number(trueDistance) + 3)) : 8
    return {
      id,
      h: randInt(rng, 1, cap),
      isGoal: false,
    }
  })

  return {
    id: `${template.name}-${originalSeed.toString(36)}-${attempt.toString(36)}`,
    seed: originalSeed,
    start: START_NODE,
    nodes,
    edges,
  }
}

function createFallbackPuzzle(seed: number): Puzzle {
  return {
    id: `fallback-${seed.toString(36)}`,
    seed,
    start: START_NODE,
    nodes: [
      { id: 'a', h: 4, isGoal: false },
      { id: 'b', h: 5, isGoal: false },
      { id: 'c', h: 2, isGoal: false },
      { id: 'd', h: 3, isGoal: false },
      { id: 'e', h: 4, isGoal: false },
      { id: 'f', h: 0, isGoal: true },
      { id: 'g', h: 0, isGoal: true },
      { id: 'h', h: 0, isGoal: true },
      { id: 'i', h: 5, isGoal: false },
      { id: 'j', h: 0, isGoal: true },
      { id: 'k', h: 1, isGoal: false },
    ],
    edges: [
      { from: 'a', to: 'b', cost: 3 },
      { from: 'a', to: 'c', cost: 4 },
      { from: 'b', to: 'd', cost: 2 },
      { from: 'b', to: 'e', cost: 5 },
      { from: 'c', to: 'f', cost: 6 },
      { from: 'c', to: 'g', cost: 4 },
      { from: 'd', to: 'h', cost: 3 },
      { from: 'd', to: 'i', cost: 8 },
      { from: 'e', to: 'j', cost: 2 },
      { from: 'g', to: 'k', cost: 7 },
    ],
  }
}

function isGoodPracticePuzzle(solution: AStarSolution): boolean {
  if (solution.status !== 'solved') {
    return false
  }

  const expansions = solution.expansionOrder.length
  const largestF = Math.max(...solution.expansionOrder.map((item) => item.f))

  return (
    expansions >= 3 &&
    expansions <= 6 &&
    solution.maxFrontier >= 2 &&
    solution.maxFrontier <= 7 &&
    solution.treeNodeCount >= 10 &&
    solution.treeNodeCount <= 11 &&
    expansions <= solution.treeNodeCount - 4 &&
    solution.tieSteps <= 3 &&
    solution.resultCost !== null &&
    solution.resultCost <= 24 &&
    largestF <= 24
  )
}

function failedSolution(
  session: SearchSession,
  steps: AStarStep[],
  expansionOrder: FrontierSnapshot[],
  maxFrontier: number,
  tieSteps: number,
  selectedNonFirstCount: number,
): AStarSolution {
  return {
    status: 'failed',
    steps,
    expansionOrder,
    resultNodeId: null,
    resultPath: [],
    resultCost: null,
    maxFrontier,
    treeNodeCount: Object.keys(session.nodes).length,
    tieSteps,
    selectedNonFirstCount,
  }
}

function snapshot(node: SearchNode): FrontierSnapshot {
  return {
    id: node.id,
    stateId: node.stateId,
    path: node.path,
    g: node.g,
    h: node.h,
    f: node.f,
    isGoal: node.isGoal,
  }
}

function getNode(puzzle: Puzzle, id: StateId): GraphNode {
  const node = puzzle.nodes.find((item) => item.id === id)
  if (!node) {
    throw new Error(`Puzzle node does not exist: ${id}`)
  }

  return node
}

function getSuccessors(puzzle: Puzzle, id: StateId): GraphEdge[] {
  return puzzle.edges.filter((edge) => edge.from === id).sort(compareEdges)
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  if (left.from !== right.from) {
    return left.from.localeCompare(right.from)
  }

  return left.to.localeCompare(right.to)
}

function computeMinGoalCosts(goals: StateId[], edges: GraphEdge[], nodeIds: StateId[]): Map<StateId, number> {
  const distances = new Map<StateId, number>()
  const unsettled = new Set<StateId>(nodeIds)

  for (const id of nodeIds) {
    distances.set(id, Number.POSITIVE_INFINITY)
  }

  for (const goal of goals) {
    distances.set(goal, 0)
  }

  while (unsettled.size > 0) {
    let best: StateId | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const id of unsettled) {
      const distance = distances.get(id) ?? Number.POSITIVE_INFINITY
      if (distance < bestDistance) {
        best = id
        bestDistance = distance
      }
    }

    if (best === null || !Number.isFinite(bestDistance)) {
      break
    }

    unsettled.delete(best)

    for (const edge of edges) {
      if (edge.to !== best || !unsettled.has(edge.from)) {
        continue
      }

      const nextDistance = bestDistance + edge.cost
      if (nextDistance < (distances.get(edge.from) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.from, nextDistance)
      }
    }
  }

  return distances
}

function makeRng(seed: number): () => number {
  let value = seed >>> 0

  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}
