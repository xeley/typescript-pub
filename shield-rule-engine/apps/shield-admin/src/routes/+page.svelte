<script lang="ts">
  import type { PageData } from "./$types.js";

  type LineError = {
    kind: string;
    message: string;
    span?: { start: { line: number; col: number } } | null;
  };
  type LineValidation = {
    position: number;
    source: string;
    errors: LineError[];
  };
  type PublishOutcome = {
    savedAs: number;
    compile: {
      errorCount: number;
      saved: boolean;
      perRule: Array<{ ruleId: string; source: string; errors: LineError[] }>;
      safety: { ok: boolean; warnings: string[] };
    };
    published: { active: number; previous: number | null } | null;
  };

  let { data } = $props<{ data: PageData }>();

  let text = $state(data.shownText);
  let validating = $state(false);
  let publishing = $state(false);
  let validation = $state<LineValidation[] | null>(null);
  let lastPublish = $state<PublishOutcome | null>(null);
  let errorMessage = $state<string | null>(null);
  let versions = $state(data.versions);
  let activeVersion = $state<number | null>(data.activeVersion);

  async function refreshState(): Promise<void> {
    const res = await fetch("/api/state");
    if (!res.ok) return;
    const next = await res.json();
    versions = next.versions;
    activeVersion = next.activeVersion;
  }

  async function validate(): Promise<void> {
    errorMessage = null;
    validating = true;
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        errorMessage = `Validate failed (${res.status}): ${await res.text()}`;
        validation = null;
        return;
      }
      const body = (await res.json()) as { lines: LineValidation[] };
      validation = body.lines;
    } finally {
      validating = false;
    }
  }

  async function publish(): Promise<void> {
    errorMessage = null;
    publishing = true;
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        errorMessage = `Publish failed (${res.status}): ${await res.text()}`;
        lastPublish = null;
        return;
      }
      lastPublish = (await res.json()) as PublishOutcome;
      validation = lastPublish.compile.perRule.map((r, i) => ({
        position: i,
        source: r.source,
        errors: r.errors,
      }));
      await refreshState();
    } finally {
      publishing = false;
    }
  }

  function totalErrors(): number {
    if (!validation) return 0;
    return validation.reduce((n, l) => n + l.errors.length, 0);
  }
</script>

<svelte:head>
  <title>Shield Admin · {data.tenantId}</title>
</svelte:head>

<main>
  <header>
    <div>
      <h1>Shield Rule Engine — Admin</h1>
      <p class="subtitle">
        tenant <code>{data.tenantId}</code>
        · active version <strong>{activeVersion ?? "—"}</strong>
        · <span class="muted">{data.dataDir}</span>
      </p>
    </div>
  </header>

  <section class="editor-section">
    <h2>Rules</h2>
    <p class="hint">
      One rule per non-empty line. Lines starting with <code>//</code> are ignored.
    </p>
    <textarea
      bind:value={text}
      spellcheck="false"
      rows="10"
      autocomplete="off"
    ></textarea>

    <div class="actions">
      <button onclick={validate} disabled={validating || publishing}>
        {validating ? "Validating…" : "Validate"}
      </button>
      <button class="primary" onclick={publish} disabled={publishing || validating}>
        {publishing ? "Publishing…" : "Compile & Publish"}
      </button>

      {#if validation}
        <span class="result">
          {#if totalErrors() === 0}
            <span class="ok">{validation.length} rule{validation.length === 1 ? "" : "s"} — clean</span>
          {:else}
            <span class="bad">{totalErrors()} error{totalErrors() === 1 ? "" : "s"} across {validation.length} rule{validation.length === 1 ? "" : "s"}</span>
          {/if}
        </span>
      {/if}
    </div>

    {#if errorMessage}
      <div class="banner bad">{errorMessage}</div>
    {/if}

    {#if lastPublish}
      <div class="banner {lastPublish.published ? 'ok' : 'bad'}">
        {#if lastPublish.published}
          Saved as version <strong>{lastPublish.savedAs}</strong>,
          compiled OK, now active
          (was {lastPublish.published.previous ?? "none"}).
          shield-eval's cache should invalidate within ~100ms.
        {:else}
          Saved as version <strong>{lastPublish.savedAs}</strong> as a DRAFT.
          {lastPublish.compile.errorCount} compile error{lastPublish.compile.errorCount === 1 ? "" : "s"} — nothing published.
        {/if}
      </div>
    {/if}

    {#if validation && validation.length > 0}
      <div class="rules-list">
        {#each validation as line, i}
          <div class="rule {line.errors.length === 0 ? 'rule-ok' : 'rule-bad'}">
            <div class="rule-header">
              <span class="rule-id">r{i + 1}</span>
              <code class="rule-source">{line.source}</code>
              {#if line.errors.length === 0}
                <span class="ok-mark">ok</span>
              {:else}
                <span class="bad-mark">{line.errors.length} error{line.errors.length === 1 ? "" : "s"}</span>
              {/if}
            </div>
            {#each line.errors as err}
              <div class="rule-error">
                <span class="err-kind">{err.kind}</span>
                {err.message}
                {#if err.span}
                  <span class="muted">at line {err.span.start.line}, col {err.span.start.col}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="versions-section">
    <h2>Versions</h2>
    {#if versions.length === 0}
      <p class="muted">No versions yet. Publish to create version 1.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>version</th>
            <th>status</th>
            <th>created</th>
            <th>active</th>
          </tr>
        </thead>
        <tbody>
          {#each [...versions].reverse() as v}
            <tr class:active={v.version === activeVersion}>
              <td><strong>{v.version}</strong></td>
              <td><span class="status status-{v.status}">{v.status}</span></td>
              <td>{new Date(v.createdAt).toLocaleString()}</td>
              <td>{v.version === activeVersion ? "← active" : ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <footer>
    <a href="/api/state" target="_blank">/api/state (json)</a>
    · shield-eval should be running on <code>http://127.0.0.1:3001</code> against the same DATA_DIR
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0f1115;
    color: #e6e8eb;
  }
  :global(*) {
    box-sizing: border-box;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px;
  }
  header {
    border-bottom: 1px solid #1f2329;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #9aa3ad;
    margin: 32px 0 8px;
  }
  .subtitle {
    color: #9aa3ad;
    font-size: 13px;
    margin: 4px 0 0;
  }
  code {
    font-family: ui-monospace, "JetBrains Mono", "Cascadia Code", monospace;
    background: #1a1d23;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 12px;
  }
  .muted {
    color: #6b7280;
    font-size: 12px;
  }
  .hint {
    color: #9aa3ad;
    font-size: 12px;
    margin: 0 0 8px;
  }
  textarea {
    width: 100%;
    font-family: ui-monospace, "JetBrains Mono", "Cascadia Code", monospace;
    font-size: 13px;
    background: #1a1d23;
    color: #e6e8eb;
    border: 1px solid #2a2f37;
    border-radius: 6px;
    padding: 12px;
    resize: vertical;
    line-height: 1.6;
  }
  textarea:focus {
    outline: none;
    border-color: #4b6fff;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  button {
    background: #1a1d23;
    color: #e6e8eb;
    border: 1px solid #2a2f37;
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    font-weight: 500;
  }
  button:hover:not(:disabled) {
    background: #21262d;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.primary {
    background: #4b6fff;
    border-color: #4b6fff;
  }
  button.primary:hover:not(:disabled) {
    background: #3a5cea;
  }
  .result {
    font-size: 12px;
    margin-left: 4px;
  }
  .ok {
    color: #4ade80;
  }
  .bad {
    color: #f87171;
  }
  .banner {
    margin-top: 12px;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
    border: 1px solid;
  }
  .banner.ok {
    background: rgba(74, 222, 128, 0.08);
    border-color: rgba(74, 222, 128, 0.35);
    color: #86efac;
  }
  .banner.bad {
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.35);
    color: #fca5a5;
  }
  .rules-list {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rule {
    border: 1px solid #2a2f37;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .rule-ok {
    border-color: rgba(74, 222, 128, 0.25);
  }
  .rule-bad {
    border-color: rgba(248, 113, 113, 0.35);
  }
  .rule-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .rule-id {
    color: #6b7280;
    font-family: ui-monospace, "JetBrains Mono", monospace;
    font-size: 11px;
  }
  .rule-source {
    flex: 1;
  }
  .ok-mark {
    color: #4ade80;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .bad-mark {
    color: #f87171;
    font-size: 11px;
  }
  .rule-error {
    margin-top: 6px;
    margin-left: 28px;
    font-size: 12px;
    color: #fca5a5;
  }
  .err-kind {
    background: rgba(248, 113, 113, 0.15);
    color: #fca5a5;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 6px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid #1f2329;
  }
  th {
    color: #6b7280;
    font-weight: 500;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  tr.active {
    background: rgba(75, 111, 255, 0.06);
  }
  .status {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 3px;
  }
  .status-draft {
    background: rgba(156, 163, 175, 0.15);
    color: #d1d5db;
  }
  .status-compiled {
    background: rgba(99, 102, 241, 0.15);
    color: #a5b4fc;
  }
  .status-active {
    background: rgba(74, 222, 128, 0.15);
    color: #86efac;
  }
  .status-retired {
    background: rgba(75, 85, 99, 0.2);
    color: #9ca3af;
  }
  footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid #1f2329;
    font-size: 12px;
    color: #6b7280;
  }
  footer a {
    color: #93c5fd;
  }
</style>
