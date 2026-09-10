import { describe, expect, it } from "vitest";
import { decidePasteSource } from "../src/sync/clipboardPaste";

describe("decidePasteSource", () => {
	it("internal copy then paste: confirmed write, OS text matches internal ⇒ internal", () => {
		const decision = decidePasteSource({
			internalMd: "- a\n- b",
			lastWrittenClipboardText: "- a\n- b",
			osText: "- a\n- b",
		});
		expect(decision).toEqual({ path: "internal" });
	});

	it("confirmed write + external OS text differs ⇒ external", () => {
		const decision = decidePasteSource({
			internalMd: "- a\n- b",
			lastWrittenClipboardText: "- a\n- b",
			osText: "something pasted from another app",
		});
		expect(decision).toEqual({ path: "external", text: "something pasted from another app" });
	});

	it("failed write (lastWritten = null, internalMd non-null) ⇒ internal, ignoring osText", () => {
		const decision = decidePasteSource({
			internalMd: "- a\n- b",
			lastWrittenClipboardText: null,
			osText: "whatever the OS clipboard happens to hold",
		});
		expect(decision).toEqual({ path: "internal" });
	});

	it("stale OS read equal to prior content but internal buffer changed since (newer copy) ⇒ internal", () => {
		// lastWrittenClipboardText reflects an OLDER internal copy; the user
		// has since copied something new, so internalMd has moved on but the
		// OS write for the new copy hasn't been confirmed yet.
		const decision = decidePasteSource({
			internalMd: "- new copy",
			lastWrittenClipboardText: "- old copy",
			osText: "- old copy",
		});
		expect(decision).toEqual({ path: "internal" });
	});

	it("internalMd === null and osText has content ⇒ external", () => {
		const decision = decidePasteSource({
			internalMd: null,
			lastWrittenClipboardText: null,
			osText: "pasted from outside",
		});
		expect(decision).toEqual({ path: "external", text: "pasted from outside" });
	});

	it("internalMd === null and osText === null ⇒ none", () => {
		const decision = decidePasteSource({
			internalMd: null,
			lastWrittenClipboardText: null,
			osText: null,
		});
		expect(decision).toEqual({ path: "none" });
	});

	it("confirmed write, OS read unavailable/failed (osText === null) ⇒ internal", () => {
		const decision = decidePasteSource({
			internalMd: "- a\n- b",
			lastWrittenClipboardText: "- a\n- b",
			osText: null,
		});
		expect(decision).toEqual({ path: "internal" });
	});
});
