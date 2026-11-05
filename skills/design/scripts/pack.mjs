#!/usr/bin/env node
/** Portable project archive: system tar only, manifest-first verification. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const fail = (m) => { console.error(`mockbird pack: ${m}`); process.exitCode = 1; };
const hash = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const secret = (p) => /(^|\/)(\.env(?:\..*)?|llm\.config(?:\.json)?|.*\.pem|.*\.key)$/i.test(p);
function files(root) {
  const out = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name)).forEach((e) => {
    const rel = relative(root, join(dir, e.name)).replaceAll("\\", "/");
    if (e.isDirectory() && !rel.startsWith(".git/") && !rel.includes("/.visual/") && !rel.includes("/.history/") && !rel.includes("/runs/")) walk(join(dir, e.name));
    else if (e.isFile() && rel !== "pack-manifest.json" && !rel.startsWith("node_modules/") && !rel.startsWith("design/.visual/runs/") && !rel.startsWith(".visual/runs/") && !secret(rel)) out.push(rel);
  }); walk(root); return out;
}
function git(root) { try { return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return null; } }
function version(root) { try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown"; } catch { return "unknown"; } }
function pack(root, archive) {
  const names = files(root); const forbidden = [];
  const all = []; const walk = (d) => readdirSync(d,{withFileTypes:true}).forEach(e => { const p=join(d,e.name), r=relative(root,p).replaceAll("\\","/"); if(e.isDirectory()) walk(p); else if(secret(r)) all.push(r); }); walk(root);
  if (all.length) throw new Error(`secret file refused: ${all[0]}`);
  const stage = mkdtempSync(join(tmpdir(), "mockbird-pack-"));
  for (const n of names) { const dest=join(stage,n); mkdirSync(dirname(dest),{recursive:true}); execFileSync("cp", [join(root,n), dest]); }
  const manifest = { schemaVersion: 1, mockbirdVersion: version(root), gitSHA: git(root), createdAt: new Date().toISOString(), files: Object.fromEntries(names.map(n => [n, { contentHash: hash(join(root,n)) }])) };
  writeFileSync(join(stage,"pack-manifest.json"), JSON.stringify(manifest,null,2)+"\n"); mkdirSync(dirname(resolve(archive)),{recursive:true});
  execFileSync("tar", ["-czf", resolve(archive), "-C", stage, "."]); rmSync(stage,{recursive:true,force:true});
}
function unpack(archive, dest) {
  const members=execFileSync("tar",["-tzf",resolve(archive)],{encoding:"utf8"}).split("\n").filter(Boolean);
  for(const n of members) if(n.startsWith("/")||n.split("/").includes("..")) throw new Error(`unsafe archive path: ${n}`);
  const stage=mkdtempSync(join(tmpdir(),"mockbird-unpack-")); execFileSync("tar",["-xzf",resolve(archive),"-C",stage]);
  const manifestPath=join(stage,"pack-manifest.json"); if(!existsSync(manifestPath)) throw new Error("pack-manifest.json missing");
  const m=JSON.parse(readFileSync(manifestPath,"utf8")); for(const [n,v] of Object.entries(m.files||{})) { if(n.startsWith("/")||n.split("/").includes("..")) throw new Error(`unsafe manifest path: ${n}`); const p=join(stage,n); if(!existsSync(p)||hash(p)!==v.contentHash) throw new Error(`checksum mismatch: ${n}`); }
  mkdirSync(resolve(dest),{recursive:true}); execFileSync("cp",["-a",`${stage}/.`,resolve(dest)]); rmSync(stage,{recursive:true,force:true});
}
const a=process.argv.slice(2); try { const mode=a[0], get=(x)=>{const i=a.indexOf(x); if(i<0||!a[i+1]) throw new Error(`missing ${x}`); return a[i+1]}; if(mode==="pack") pack(resolve(get("--project")),get("--out")); else if(mode==="unpack") unpack(get("--archive"),get("--out")); else throw new Error("usage: pack --project DIR --out FILE.tar.gz | unpack --archive FILE --out DIR"); } catch(e) { fail(e.message); }
