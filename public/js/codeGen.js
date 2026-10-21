/**
 * Live Code Generator for cURL, Python (`anthropic` SDK), and TypeScript (`@anthropic-ai/sdk`)
 * Always reflects the exact payload currently configured in the workbench.
 */

export function generateSdkCode(payload = {}, lang = "python") {
  const clean = { ...payload };
  delete clean._sim_cache_mode;
  delete clean._stream_delay_ms;
  delete clean._mode;

  const isStream = Boolean(clean.stream);

  if (lang === "curl") {
    return `curl https://api.anthropic.com/v1/messages \\
  --header "x-api-key: $ANTHROPIC_API_KEY" \\
  --header "anthropic-version: 2023-06-01" \\
  --header "content-type: application/json" \\
  --data '${JSON.stringify(clean, null, 2).replace(/'/g, "'\\''")}'`;
  }

  if (lang === "typescript") {
    const bodyWithoutStream = { ...clean };
    delete bodyWithoutStream.stream;
    const argsStr = indentLines(JSON.stringify(bodyWithoutStream, null, 2), 2);

    if (isStream) {
      return `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const stream = await client.messages.create({
${argsStr.slice(3, -2)},
  stream: true,
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}`;
    }

    return `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const message = await client.messages.create(${JSON.stringify(clean, null, 2)});

console.log(message.content);`;
  }

  // Default: Python SDK
  const pyArgs = [];
  pyArgs.push(`    model=${JSON.stringify(clean.model || "claude-sonnet-4-6")},`);
  pyArgs.push(`    max_tokens=${clean.max_tokens || 1024},`);

  if (clean.thinking) {
    pyArgs.push(`    thinking=${toPythonLiteral(clean.thinking, 4)},`);
  }
  if (clean.output_config) {
    pyArgs.push(`    output_config=${toPythonLiteral(clean.output_config, 4)},`);
  }
  if (clean.temperature !== undefined) {
    pyArgs.push(`    temperature=${clean.temperature},  # WARNING: Deprecated on Claude 4.6/4.7+ (throws HTTP 400)`);
  }
  if (clean.system) {
    pyArgs.push(`    system=${toPythonLiteral(clean.system, 4)},`);
  }
  if (clean.stop_sequences?.length) {
    pyArgs.push(`    stop_sequences=${toPythonLiteral(clean.stop_sequences, 4)},`);
  }
  if (clean.tools?.length) {
    pyArgs.push(`    tools=${toPythonLiteral(clean.tools, 4)},`);
  }
  if (clean.tool_choice) {
    pyArgs.push(`    tool_choice=${toPythonLiteral(clean.tool_choice, 4)},`);
  }
  pyArgs.push(`    messages=${toPythonLiteral(clean.messages || [], 4)}`);

  if (isStream) {
    return `import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
${pyArgs.join("\n")}
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)`;
  }

  return `import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
${pyArgs.join("\n")}
)

print(message.content)`;
}

function toPythonLiteral(val, indent = 4) {
  const json = JSON.stringify(val, null, 2);
  const py = json
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
  const lines = py.split("\n");
  if (lines.length <= 1) return py;
  const pad = " ".repeat(indent);
  return lines[0] + "\n" + lines.slice(1).map((l) => pad + l).join("\n");
}

function indentLines(str, spaces = 2) {
  const pad = " ".repeat(spaces);
  return str
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

/**
 * Formats a JSON object with HTML syntax highlighting for the Inspector pane.
 */
export function syntaxHighlightJson(obj) {
  const json = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "text-slate-500";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}
