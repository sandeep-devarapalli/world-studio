# Capture Splat Live Security M1

This document records the desktop security boundary added after the replay-first M0
receiver. It is an implementation checkpoint inside M1, not evidence that the full
iPhone-to-Mac milestone has passed.

## Boundary

M0 remains unchanged:

- the replay receiver binds only to `127.0.0.1` or `::1`;
- startup is explicit;
- session, frame, asset, ACK, duplicate, gap, resume, and finalization behavior stays in the
  existing receiver/store;
- live evidence remains `proposal_only` and cannot replace a loaded `WorldSession`.

M1 adds a separate authenticated local-network path:

- the user explicitly chooses one enumerated interface rather than opening a wildcard bind;
- a short-lived pairing invitation identifies this Mac and pins its self-signed TLS
  certificate;
- Bonjour publishes `_capturesplat._tcp` without browsing for or trusting discovered hosts;
- the iPhone proves a P-256 device identity while accepting the pinned desktop identity;
- finite grants carry scopes, pairing epoch, expiry, and revocation state;
- authenticated requests use P-256 ES256/P1363 signatures and bind their grant, method,
  exact path, content metadata, body SHA-256, timestamp, and request counter;
- the authenticated gateway delegates accepted requests to the same M0 evidence ledger.

Only the pairing exchange is available before pairing succeeds. Live-session routes on the
selected interface require TLS pinning and a valid device grant. The loopback replay
receiver is not widened or silently converted into a LAN server.

## Identity And Persistence

The desktop uses a persistent P-256 identity:

```text
capture_splat.desktop_identity.v0.1
```

The public key determines the stable desktop identity. The private key is protected through
the Electron/macOS secret-storage boundary. A self-signed certificate is issued with the
absolute macOS `/usr/bin/openssl` executable; no shell or downloaded certificate tool is
used. Certificate bytes are public, but the QR invitation pins their fingerprint to the
specific desktop pairing action.

Paired devices and grants are stored under:

```text
capture_splat.pairing_registry.v0.1
```

The registry records public device identity, display name, pairing epoch, grant ID and
scopes, issuance/expiry, revocation, and replay state. It must never contain invitation
secrets or private keys. Current revocation state is durable and takes effect independently
of any active network connection. An explicit successful re-pair advances the epoch and
creates the new current grant; older epochs remain cryptographically unusable but are not
an append-only audit ledger in this checkpoint.

## Signed Requests And Replay Defense

The device signs canonical request metadata with its P-256 key. The signed body digest is
checked again at the receiver boundary:

- buffered JSON is hashed before parsing and before store mutation;
- streamed asset digest metadata must equal the asset checksum declared by the frame;
- the existing store still verifies actual byte length and SHA-256 before ACK.

Each grant uses an unsigned 64-bit request counter. The registry durably retains the highest
accepted counter plus a 256-bit sliding bitmap. A previously unseen out-of-order counter
inside that window may be accepted once. A duplicate counter or a counter older than the
window is rejected, including after receiver restart. `request_id` is for correlation only
and is never treated as replay authority.

Lost transport ACKs do not weaken this rule. The sender retries the same idempotent evidence
operation with a fresh signed request counter; the M0 receiver then reports an identical
retry as a logical duplicate.

## Bonjour And QR Boundary

Bonjour publication uses:

```text
/usr/bin/dns-sd -R <derived-name> _capturesplat._tcp local. <port> <allowlisted TXT>
```

The instance name is derived from the desktop identity. TXT fields are limited to public
protocol version, pairing/paired mode, desktop identity, TLS fingerprint, HTTPS transport,
and authentication algorithm. Invitation secrets, verification codes, device grants,
private keys, and request counters are rejected.

The desktop pairing state carries a short-lived invitation URI and a human verification
code. The URI intentionally includes the ephemeral invitation secret so the trusted bundled
renderer can draw the QR; that field is cleared after the invitation is submitted,
cancelled, consumed, or expired and is excluded from Bonjour, logs, and evidence packages.
The web package uses MIT-licensed `qrcode` 1.5.4 with `@types/qrcode` 1.5.6; Vite bundles it
into the renderer, so the packaged desktop main process gains no new runtime dependency.
Capture Splat owns the canonical schemas and fixtures under
`contracts/live-auth/v0.1`; World Studio mirrors them byte-for-byte and verifies fixed
SHA-256 fingerprints. A rendered QR is not the same as a physically validated scan/pair
flow.

## macOS Package Metadata

The packaged app declares:

- `NSLocalNetworkUsageDescription`, explaining that local-network use begins only after
  explicit Capture Splat pairing;
- `NSBonjourServices = [\"_capturesplat._tcp\"]`.

No other Bonjour service type is declared. These plist entries permit the operating system
to ask for access; they do not prove that permission, firewall behavior, discovery, or
pairing works on a physical Mac/iPhone pair. The packaged smoke gate extracts the final
`Info.plist`, asserts the exact purpose string, and requires the Bonjour array to contain
only `_capturesplat._tcp`.

## Authority And Isolation

Pairing authenticates transport and device identity. It does not promote received content.
RGB, depth, confidence, masks, cameras, trajectories, meshes, and future reconstruction
outputs remain source evidence or proposals according to their existing contracts.

This checkpoint does not:

- modify the Capture Splat iPhone capture loop;
- connect the bounded sender foundation to capture writes or claim physical queue budgets;
- run i3dgs, LingBot Map, gsplat, or another reconstruction worker;
- mutate or replace an already loaded world;
- establish metric, collision, semantic, navigation, physics, or safety authority.

## Optional Live-Transport Promotion

The secure transport remains available for research and future device classes, but iPhone
live transfer is disabled by default and is not required for M1 completion. The following
evidence is required only before promoting live transport on a specific device class:

1. A real Capture Splat pairing client outside the capture loop and physical QR scan.
2. Physical validation of bounded local-first store-and-forward with persistent resume
   state and no harmful thermal or throughput regression.
3. Packaged-app verification of macOS local-network permission and firewall behavior.
4. Physical Bonjour discovery and pinned-TLS pairing on the intended Wi-Fi network.
5. Two complete iPhone-to-Mac capture cycles, including receiver restart and Wi-Fi
   interruption.
6. Measured phone memory, queue bytes/frames, storage, thermal state, writer drops,
   throughput, recovery, and finalization.
7. Optional reconstruction-worker contracts and failure-isolation evidence in a later PR.
