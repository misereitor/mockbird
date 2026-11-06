import { existsSync, readFileSync } from "node:fs"
import { dirname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MAP = join(HERE, "subsystem-map.json")
const mapFile = process.argv[2] || DEFAULT_MAP
const map = JSON.parse(readFileSync(mapFile, "utf8"))
const root = resolve(dirname(mapFile), map.root || ".")
const owners = map.owners || {}
const allowed = new Set((map.allowedEdges || []).map((edge) => edge.join("\0")))
const ownerByPath = new Map()
const errors = []

for (const [owner, paths] of Object.entries(owners)) {
  for (const relativePath of paths) {
    const key = normalize(relativePath)
    if (ownerByPath.has(key)) errors.push(`duplicate owner: ${key} (${owner} and ${ownerByPath.get(key)})`)
    ownerByPath.set(key, owner)
    if (!existsSync(resolve(root, relativePath))) errors.push(`missing path: ${owner} owns ${relativePath}`)
  }
}

const imports = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\s*\(\s*)["']([^"']+)["']/g
const moduleFor = (relativePath) => ownerByPath.get(normalize(relativePath))
for (const [relativePath, owner] of ownerByPath) {
  if (!existsSync(resolve(root, relativePath))) continue
  const source = readFileSync(resolve(root, relativePath), "utf8")
  for (const match of source.matchAll(imports)) {
    const specifier = match[1]
    if (!specifier.startsWith(".")) continue
    const target = normalize(join(dirname(relativePath), specifier)).replace(/\.m?js$/, ".mjs")
    const targetOwner = moduleFor(target)
    if (!targetOwner || targetOwner === owner) continue
    if (!allowed.has(`${owner}\0${targetOwner}`)) errors.push(`forbidden edge: ${owner} (${relativePath}) -> ${targetOwner} (${target})`)
  }
}

const graph = new Map(Object.keys(owners).map((owner) => [owner, new Set()]))
for (const edge of map.allowedEdges || []) {
  if (edge.length !== 2 || !graph.has(edge[0]) || !graph.has(edge[1])) errors.push(`invalid allowed edge: ${edge.join(" -> ")}`)
  else graph.get(edge[0]).add(edge[1])
}
const visiting = new Set(); const visited = new Set()
function visit(owner, trail = []) {
  if (visiting.has(owner)) { errors.push(`dependency cycle: ${[...trail, owner].join(" -> ")}`); return }
  if (visited.has(owner)) return
  visiting.add(owner)
  for (const next of graph.get(owner) || []) visit(next, [...trail, owner])
  visiting.delete(owner); visited.add(owner)
}
for (const owner of graph.keys()) visit(owner)

if (errors.length) { for (const error of errors) console.error(`SUBSYSTEM BOUNDARY ERROR: ${error}`); process.exitCode = 1 }
else console.log(`SUBSYSTEM BOUNDARIES OK: ${ownerByPath.size} paths, ${map.allowedEdges?.length || 0} allowed edges`)
