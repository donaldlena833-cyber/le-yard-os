#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marketplacePath = join(repositoryRoot, ".agents", "plugins", "marketplace.json");
const allowedInstallationPolicies = new Set([
  "NOT_AVAILABLE",
  "AVAILABLE",
  "INSTALLED_BY_DEFAULT",
]);
const allowedAuthenticationPolicies = new Set(["ON_INSTALL", "ON_USE"]);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const errors = [];

function addError(message) {
  errors.push(message);
}

async function readJson(path, label) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      addError(`${label} must contain a JSON object.`);
      return null;
    }
    return parsed;
  } catch (error) {
    addError(`${label} is not readable valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isInsideRoot(path, root) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function validateHttpsUrl(value, label) {
  if (value === undefined) return;
  if (!isNonEmptyString(value)) {
    addError(`${label} must be a non-empty HTTPS URL.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") addError(`${label} must use HTTPS.`);
  } catch {
    addError(`${label} must be an absolute HTTPS URL.`);
  }
}

function validateDefaultPrompts(value, label) {
  const prompts = typeof value === "string" ? [value] : value;
  if (!Array.isArray(prompts) || prompts.length === 0 || prompts.length > 3) {
    addError(`${label} must be a string or an array of one to three strings.`);
    return;
  }
  prompts.forEach((prompt, index) => {
    if (!isNonEmptyString(prompt)) addError(`${label}[${index}] must be non-empty.`);
    if (typeof prompt === "string" && prompt.length > 128) {
      addError(`${label}[${index}] exceeds 128 characters.`);
    }
  });
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readFrontmatterField(contents, field, label) {
  const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) {
    addError(`${label} must start with closed YAML frontmatter.`);
    return null;
  }
  const match = frontmatter[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!match || !unquote(match[1])) {
    addError(`${label} frontmatter field '${field}' must be non-empty.`);
    return null;
  }
  return unquote(match[1]);
}

async function validateSkill(skillRoot, pluginName) {
  const skillName = skillRoot.split(sep).at(-1);
  const label = `plugin '${pluginName}' skill '${skillName}'`;
  let contents;
  try {
    contents = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  } catch {
    addError(`${label} is missing SKILL.md.`);
    return;
  }
  if (contents.includes("[TODO:")) addError(`${label} contains an unfinished TODO placeholder.`);
  const declaredName = readFrontmatterField(contents, "name", `${label} SKILL.md`);
  const description = readFrontmatterField(contents, "description", `${label} SKILL.md`);
  if (declaredName && declaredName !== skillName) {
    addError(`${label} frontmatter name must match its directory.`);
  }
  if (description && description.length < 20) {
    addError(`${label} description is too vague for reliable discovery.`);
  }
  try {
    const agentYaml = await readFile(join(skillRoot, "agents", "openai.yaml"), "utf8");
    if (!agentYaml.includes(`$${skillName}`)) {
      addError(`${label} agents/openai.yaml default prompt must name $${skillName}.`);
    }
    if (agentYaml.includes("[TODO:")) {
      addError(`${label} agents/openai.yaml contains an unfinished TODO placeholder.`);
    }
  } catch {
    addError(`${label} is missing agents/openai.yaml.`);
  }
}

async function validatePlugin(entry) {
  const pluginName = entry.name;
  const expectedSourcePath = `./plugins/${pluginName}`;
  if (!entry.source || typeof entry.source !== "object" || Array.isArray(entry.source)) {
    addError(`Marketplace plugin '${pluginName}' must have a source object.`);
    return;
  }
  if (entry.source.source !== "local") {
    addError(`Marketplace plugin '${pluginName}' must use the local source type.`);
  }
  if (entry.source.path !== expectedSourcePath) {
    addError(`Marketplace plugin '${pluginName}' source path must be '${expectedSourcePath}'.`);
  }
  if (!entry.policy || typeof entry.policy !== "object" || Array.isArray(entry.policy)) {
    addError(`Marketplace plugin '${pluginName}' must declare policy.`);
  } else {
    if (!allowedInstallationPolicies.has(entry.policy.installation)) {
      addError(`Marketplace plugin '${pluginName}' has an invalid installation policy.`);
    }
    if (!allowedAuthenticationPolicies.has(entry.policy.authentication)) {
      addError(`Marketplace plugin '${pluginName}' has an invalid authentication policy.`);
    }
  }
  if (!isNonEmptyString(entry.category)) {
    addError(`Marketplace plugin '${pluginName}' must declare category.`);
  }

  const pluginRoot = resolve(repositoryRoot, "plugins", pluginName);
  if (!isInsideRoot(pluginRoot, join(repositoryRoot, "plugins"))) {
    addError(`Marketplace plugin '${pluginName}' resolves outside the plugin root.`);
    return;
  }
  const manifest = await readJson(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    `Plugin manifest for '${pluginName}'`,
  );
  if (!manifest) return;
  if (JSON.stringify(manifest).includes("[TODO:")) {
    addError(`Plugin manifest for '${pluginName}' contains an unfinished TODO placeholder.`);
  }
  if (manifest.name !== pluginName) addError(`Plugin manifest name must match '${pluginName}'.`);
  if (!isNonEmptyString(manifest.version) || !semverPattern.test(manifest.version)) {
    addError(`Plugin '${pluginName}' version must use strict semantic versioning.`);
  }
  if (!isNonEmptyString(manifest.description)) addError(`Plugin '${pluginName}' needs a description.`);
  if (!manifest.author || !isNonEmptyString(manifest.author.name)) {
    addError(`Plugin '${pluginName}' needs author.name.`);
  }
  validateHttpsUrl(manifest.homepage, `Plugin '${pluginName}' homepage`);
  validateHttpsUrl(manifest.repository, `Plugin '${pluginName}' repository`);
  validateHttpsUrl(manifest.author?.url, `Plugin '${pluginName}' author.url`);
  if (manifest.skills !== "./skills/") {
    addError(`Plugin '${pluginName}' skills must resolve from './skills/'.`);
  }
  if (manifest.apps !== undefined) {
    try {
      await readFile(join(pluginRoot, ".app.json"));
    } catch {
      addError(`Plugin '${pluginName}' declares apps without .app.json.`);
    }
  }
  if (typeof manifest.mcpServers === "string") {
    try {
      await readFile(join(pluginRoot, ".mcp.json"));
    } catch {
      addError(`Plugin '${pluginName}' declares mcpServers without .mcp.json.`);
    }
  }

  const ui = manifest.interface;
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    addError(`Plugin '${pluginName}' needs interface metadata.`);
  } else {
    for (const field of [
      "displayName",
      "shortDescription",
      "longDescription",
      "developerName",
      "category",
    ]) {
      if (!isNonEmptyString(ui[field])) addError(`Plugin '${pluginName}' interface.${field} is required.`);
    }
    if (!Array.isArray(ui.capabilities) || ui.capabilities.length === 0) {
      addError(`Plugin '${pluginName}' interface.capabilities must be non-empty.`);
    }
    validateDefaultPrompts(ui.defaultPrompt ?? ui.default_prompt, `Plugin '${pluginName}' defaultPrompt`);
    validateHttpsUrl(ui.websiteURL, `Plugin '${pluginName}' interface.websiteURL`);
  }

  const skillsRoot = join(pluginRoot, "skills");
  let skillDirectories = [];
  try {
    skillDirectories = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  } catch {
    addError(`Plugin '${pluginName}' is missing its skills directory.`);
    return;
  }
  if (skillDirectories.length === 0) addError(`Plugin '${pluginName}' must include at least one skill.`);
  for (const skillDirectory of skillDirectories) {
    await validateSkill(join(skillsRoot, skillDirectory.name), pluginName);
  }
  return skillDirectories.map((skillDirectory) => skillDirectory.name);
}

async function main() {
  const marketplace = await readJson(marketplacePath, "Marketplace manifest");
  if (!marketplace) throw new Error("Marketplace validation could not start.");
  if (!isNonEmptyString(marketplace.name)) addError("Marketplace name is required.");
  if (!isNonEmptyString(marketplace.interface?.displayName)) {
    addError("Marketplace interface.displayName is required.");
  }
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError("Marketplace plugins must be a non-empty array.");
  }

  const pluginNames = new Set();
  const skillNames = new Set();
  for (const [index, entry] of (marketplace.plugins ?? []).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      addError(`Marketplace plugins[${index}] must be an object.`);
      continue;
    }
    if (!isNonEmptyString(entry.name)) {
      addError(`Marketplace plugins[${index}] needs a name.`);
      continue;
    }
    if (pluginNames.has(entry.name)) addError(`Marketplace plugin '${entry.name}' is duplicated.`);
    pluginNames.add(entry.name);
    const foundSkills = await validatePlugin(entry);
    for (const skillName of foundSkills ?? []) {
      if (skillNames.has(skillName)) addError(`Skill '${skillName}' is duplicated across plugins.`);
      skillNames.add(skillName);
    }
  }

  try {
    const pluginDirectories = (await readdir(join(repositoryRoot, "plugins"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    for (const pluginDirectory of pluginDirectories) {
      if (!pluginNames.has(pluginDirectory)) {
        addError(`Plugin directory '${pluginDirectory}' is not listed in marketplace.json.`);
      }
    }
  } catch {
    addError("Repository plugins directory is missing.");
  }

  if (errors.length > 0) {
    process.stderr.write("Le Yard OS plugin marketplace validation failed:\n");
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Validated Le Yard OS marketplace: ${pluginNames.size} plugins, ${skillNames.size} skills.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
