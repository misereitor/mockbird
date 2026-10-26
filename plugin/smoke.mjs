// Plugin smoke test: exercises frontmatter, loadSkills and syncProject for real.
import { frontmatter, loadSkills, syncProject } from "./index.ts"

const fm = frontmatter("---\nname: design\ndescription: Test description\n---\n# body")
console.log("frontmatter:", JSON.stringify(fm))

const skills = loadSkills()
console.log("skills:", skills.map((s) => `${s.id} (${s.content.length} chars)`).join(", "))

const target = process.argv[2]
if (target) {
  const summary = syncProject(target)
  console.log("sync:", summary ? JSON.stringify(summary) : "skipped (no design/ folder)")
} else {
  console.log("sync: no target given - skipped")
}
