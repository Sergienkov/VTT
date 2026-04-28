import fs from 'node:fs';

const file = process.argv[2] ?? '/tmp/figma_file.json';
const startNode = process.argv[3] ?? '274:15604';
const pageId = process.argv[4] ?? '0:1';

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map();
const parent = new Map();
const pageOf = new Map();

function walk(node, parentNode, currentPageId) {
  nodes.set(node.id, node);
  if (parentNode) parent.set(node.id, parentNode.id);

  const nextPageId = node.type === 'CANVAS' ? node.id : currentPageId;
  pageOf.set(node.id, nextPageId);

  for (const child of node.children ?? []) {
    walk(child, node, nextPageId);
  }
}

walk(data.document, null, null);

function box(node) {
  return node?.absoluteBoundingBox;
}

function isPrototypeScreen(node) {
  const bounds = box(node);
  return (
    node?.type === 'FRAME' &&
    bounds &&
    Math.abs(bounds.width - 402) < 1 &&
    bounds.height >= 800 &&
    bounds.height < 2200 &&
    pageOf.get(node.id) === pageId
  );
}

function screenOf(id) {
  let node = nodes.get(id);
  while (node) {
    if (isPrototypeScreen(node)) return node.id;
    const parentId = parent.get(node.id);
    node = parentId ? nodes.get(parentId) : null;
  }
  return null;
}

const edges = [];

for (const [id, node] of nodes) {
  const sourceScreen = screenOf(id);
  if (!sourceScreen || !node.interactions?.length) continue;

  for (const interaction of node.interactions) {
    for (const action of interaction.actions ?? []) {
      if (!action?.destinationId) continue;
      const destinationNode = nodes.get(action.destinationId);
      const destinationScreen = isPrototypeScreen(destinationNode)
        ? action.destinationId
        : screenOf(action.destinationId);

      edges.push({
        sourceScreen,
        destination: action.destinationId,
        destinationScreen,
        triggerName: node.name,
        triggerType: node.type,
      });
    }
  }
}

const bySource = new Map();
for (const edge of edges) {
  if (!bySource.has(edge.sourceScreen)) bySource.set(edge.sourceScreen, []);
  bySource.get(edge.sourceScreen).push(edge);
}

const reachable = new Set([startNode]);
const queue = [startNode];

while (queue.length) {
  const current = queue.shift();
  for (const edge of bySource.get(current) ?? []) {
    if (edge.destinationScreen && !reachable.has(edge.destinationScreen)) {
      reachable.add(edge.destinationScreen);
      queue.push(edge.destinationScreen);
    }
  }
}

const screens = [...reachable]
  .filter((id) => {
    if (nodes.has(id)) return true;
    console.error(`missing node ${id}`);
    return false;
  })
  .map((id) => {
    const node = nodes.get(id);
    const bounds = box(node);
    return {
      id,
      name: node.name,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
    };
  })
  .sort((a, b) => a.y - b.y || a.x - b.x);

console.log(`reachable screens ${screens.length}`);
for (const screen of screens) {
  console.log(
    `${screen.id}\t${screen.name}\t${screen.width}x${screen.height}\t${screen.x},${screen.y}`,
  );
}

console.log('\nedges');
for (const edge of edges.filter((item) => reachable.has(item.sourceScreen))) {
  console.log(
    `${edge.sourceScreen} -> ${edge.destinationScreen ?? edge.destination} via ${edge.triggerName} [${edge.destination}]`,
  );
}
