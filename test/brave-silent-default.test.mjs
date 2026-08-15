import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const indexUrl = new URL("../index.ts", import.meta.url).href;

async function createHome(config) {
	const root = await mkdtemp(join(tmpdir(), "pi-web-access-brave-silent-"));
	const agentDir = join(root, "agent-dir");
	await mkdir(agentDir, { recursive: true });
	await writeFile(join(agentDir, "web-search.json"), JSON.stringify(config) + "\n", "utf8");
	return agentDir;
}

function runSearch(agentDir, params) {
	const childEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
	for (const key of ["BRAVE_API_KEY", "PARALLEL_API_KEY", "TINYFISH_API_KEY", "SEARCH1API_KEY", "SEARCHINFINITY_API_KEY", "QUERIT_API_KEY", "TAVILY_API_KEY", "FIRECRAWL_BASE_URL", "FIRECRAWL_API_KEY", "JINA_API_KEY", "SERPDIVE_API_KEY", "KAGI_API_KEY", "OLLAMA_API_KEY", "SERPBASE_API_KEY", "ANYSEARCH_API_KEY", "XAI_API_KEY", "BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE", "SEARXNG_BASE_URL", "EXA_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "OPENAI_API_KEY"]) {
		delete childEnv[key];
	}
	const child = spawnSync(process.execPath, ["--input-type=module"], {
		input: `
		const calls = [];
		globalThis.fetch = async (url) => {
			const urlText = String(url);
			calls.push(urlText);
			if (urlText.startsWith("https://api.search.brave.com/")) {
				return new Response(JSON.stringify({
					grounding: { generic: [{ title: "Brave result", url: "https://example.com/brave", snippets: ["brave answer"] }] },
				}), { status: 200 });
			}
			if (urlText === "https://api.tavily.com/search") {
				return new Response(JSON.stringify({ answer: "tavily answer", results: [{ title: "Tavily source", url: "https://tavily.example/source", content: "tavily result" }] }), { status: 200 });
			}
			throw new Error("Unexpected fetch: " + urlText);
		};
		const tools = [];
		const pi = {
			registerTool(tool) { tools.push(tool); },
			registerShortcut() {},
			registerCommand() {},
			on() {},
			appendEntry() {},
			sendMessage() {},
		};
		const extension = (await import(${JSON.stringify(indexUrl)})).default;
		extension(pi);
		const tool = tools.find((candidate) => candidate.name === "web_search");
		const result = await tool.execute("brave-silent-test", ${JSON.stringify(params)}, undefined, undefined, undefined);
		console.log(JSON.stringify({ calls, result }));
	`,
		encoding: "utf8",
		env: childEnv,
		maxBuffer: 2 * 1024 * 1024,
	});
	assert.equal(child.status, 0, child.stderr);
	return JSON.parse(child.stdout.trim());
}

test("Brave search skips the browser curator by default and returns silent results", async () => {
	const home = await createHome({ provider: "brave", braveApiKey: "brave-test-key" });
	const output = runSearch(home, { query: "silent brave" });
	assert.equal(output.calls.length, 1);
	assert.ok(output.calls[0].startsWith("https://api.search.brave.com/res/v1/llm/context?q=silent+brave"));
	const text = JSON.stringify(output.result);
	assert.match(text, /https:\/\/example\.com\/brave/);
	assert.doesNotMatch(text, /Curation requires an active extension context/);
});

test("non-Brave providers still default to the browser curator", async () => {
	const home = await createHome({ provider: "tavily", tavilyApiKey: "tavily-test-key" });
	const output = runSearch(home, { query: "curated tavily" });
	assert.deepEqual(output.calls, []);
	assert.match(JSON.stringify(output.result), /Curation requires an active extension context/);
});

test("explicit summary-review still opens the curator path for Brave", async () => {
	const home = await createHome({ provider: "brave", braveApiKey: "brave-test-key" });
	const output = runSearch(home, { query: "curated brave", workflow: "summary-review" });
	assert.deepEqual(output.calls, []);
	assert.match(JSON.stringify(output.result), /Curation requires an active extension context/);
});
