// Smoke test do plugin: exercita frontmatter, loadSkills e syncProject de verdade.
import { frontmatter, loadSkills, syncProject } from "./index.ts"

const fm = frontmatter("---\nname: design\ndescription: Teste de descricao\n---\n# corpo")
console.log("frontmatter:", JSON.stringify(fm))

const skills = loadSkills()
console.log("skills:", skills.map((s) => `${s.id} (${s.content.length} chars)`).join(", "))

const target = process.argv[2]
if (target) {
  const summary = syncProject(target)
  console.log("sync:", summary ? JSON.stringify(summary) : "pulado (sem design/)")
} else {
  console.log("sync: nenhum alvo passado — pulado")
}
