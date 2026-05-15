# Named `.env` fragments (modes)

Tiny starting points for **`gzmo-daemon/.env`** (merge manually; keep `VAULT_PATH` absolute). See [README.md — Configure](../README.md#configure-environment-variables) for full knobs.

| File | Intent |
|------|--------|
| [`writer.env.fragment`](writer.env.fragment) | **`core`** + light think retrieval + larger episodic memory + cabinet working-set excerpts |
| [`scholar.env.fragment`](scholar.env.fragment) | Retrieval-heavy **`interactive`**-ish defaults (adjust model paths locally) |
| [`art.env.fragment`](art.env.fragment) | Creativity / autonomy preset matching **`GZMO_PROFILE=art`** (+ explicit think retrieval off) |
