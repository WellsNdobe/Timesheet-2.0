import { describe, expect, it } from "vitest";
import { passwordResetEmail } from "../src/email/templates/passwordReset.js";

describe("password reset email template", () => {
  it("includes the exact reset URL, expiry, security notice, and plain-text fallback", () => {
    const resetUrl = "https://tempoledger.example/reset-password?token=secret-token-value";
    const content = passwordResetEmail({ recipientEmail: "maia@example.com", resetUrl, expiresAt: new Date("2026-08-16T12:30:00.000Z") });
    expect(content.subject).toBe("Reset your TempoLedger password");
    expect(content.text).toContain(resetUrl);
    expect(content.text).toContain("16 August 2026");
    expect(content.text).toContain("30 minutes");
    expect(content.text).toContain("did not request");
    expect(content.html).toContain(resetUrl.replaceAll("&", "&amp;"));
    expect(content.html).toContain("can only be used once");
  });

  it("escapes recipient and URL content in HTML", () => {
    const content = passwordResetEmail({ recipientEmail: "<maia@example.com>", resetUrl: "https://example.com/reset?token=<unsafe>&next=\"bad\"", expiresAt: new Date("2026-08-16T12:30:00.000Z") });
    expect(content.html).not.toContain("<maia@example.com>");
    expect(content.html).toContain("&lt;maia@example.com&gt;");
    expect(content.html).toContain("&lt;unsafe&gt;&amp;next=&quot;bad&quot;");
  });
});
