// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { measureTextWidth } from "../src/render/textMeasure";

describe("measureTextWidth", () => {
	it("returns null rather than throwing when real text metrics aren't available (jsdom has no font layout)", () => {
		expect(measureTextWidth("hello world", 16)).toBeNull();
	});

	it("returns 0 for empty text without touching the DOM", () => {
		expect(measureTextWidth("", 16)).toBe(0);
	});
});
