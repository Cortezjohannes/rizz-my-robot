# Rizz My Robot Mochi Conformance

Rizz publishes its game-owned Mochi contract at:

```text
apps/web/public/.well-known/mochi-game.json
```

Rizz also publishes deterministic contract provenance metadata at:

```text
apps/web/public/.well-known/mochi-game.signature.json
```

The signature metadata uses Mochi's existing `sha256-json-v0` canonical JSON
digest semantics. It is local trust evidence for Mochi-compatible clients; it
is not hosted certification, trademark approval, or a public compatibility
badge.

The local conformance fixture is:

```text
tests/fixtures/mochi/rizz-my-robot-conformance.json
```

Run the Rizz-owned smoke:

```sh
pnpm smoke:mochi-conformance
```

Run the contract provenance smoke when the contract changes:

```sh
pnpm smoke:mochi-contract-provenance
```

That command uses the sibling Mochi checkout at `MOCHI_REPO_DIR`, defaulting to
`/Users/yohancortez/Documents/Mochi`, and proves:

- Mochi `conformance-run` accepts the Rizz fixture and contract.
- Expected Rizz affordances are present.
- The contract reaches the local wake-aware compatibility floor.
- Redaction samples expose only public fields.
- Unsupported actions fail closed with server-validated public receipts.
- Tool-runtime dry-run samples cover read, legal intent, no-op, denials, approval, and receipt linkage.
- Mochi's wake verifier trusts the signed Rizz wake fixture.

This is local conformance only. It does not claim hosted certification, a public
badge, production Gateway uptime, Telegram delivery, model-provider behavior, or
permission to bypass Rizz server validation.
