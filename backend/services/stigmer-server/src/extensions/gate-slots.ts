/**
 * Named gate slots — the pipeline injection mechanism of the convergence
 * blueprint (20260826.02 blueprint/03 §3, DD-006 §2). A slot is a point in
 * a shared per-RPC chain where the builder splices extension-registered
 * gate steps: zero steps in OSS, the cloud's gates in the cloud
 * composition. Slot names are PROTECTED VOCABULARY (never renamed,
 * byte-stable), scoped `<chain-name>:<position>`.
 *
 * O1 (20260826.09) ships the mechanism; O4 declares the six ratified slots
 * at their Java-verified semantic positions and adds each name to BOTH
 * layers below. Until then no slot exists, so every registration is the
 * §2b unknown-slot boot throw — proven by the extension test suite.
 *
 * Two enforcement layers, deliberately redundant:
 *   - GateSlotName (compile time): the union of declared slot literals.
 *     Empty today, so a TS consumer cannot even express a registration.
 *   - DECLARED_GATE_SLOTS (boot time): the load-bearing §2b contract. A JS
 *     consumer, or a composition built against a pin where a slot has
 *     since moved, must throw loudly at boot — never no-op silently.
 */

/**
 * The declared slot-name union. Grows only with owner-visible slot
 * additions (a slot table change in the blueprint's successor docs — O4
 * declares the first six). `never` is the honest empty union: no slot
 * exists, so no registration typechecks.
 */
export type GateSlotName = never;

/**
 * The boot-time declared-slot set — resolveExtensions validates every
 * registration against it. Kept in lockstep with GateSlotName by hand;
 * the extension suite pins the correspondence once slots exist.
 */
export const DECLARED_GATE_SLOTS: ReadonlySet<string> = new Set<string>();
