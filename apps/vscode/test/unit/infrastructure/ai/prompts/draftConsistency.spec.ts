import { describe, expect, it } from "vitest"

import { DraftConsistencyPrompt } from "@storyboard/story-ai"

describe("DraftConsistencyPrompt (#260)", () => {
  it.each(["generic", "xs"] as const)("asks for statements that cannot both be true for the %s variant", (variant) => {
    const prompt = DraftConsistencyPrompt.build("본문 하나", ["하나 — 설명: 키가 작다"], variant)

    expect(prompt.system).toContain("함께 참일 수 없는 두 진술")
    expect(prompt.user).toContain("[설정]\n하나 — 설명: 키가 작다")
    expect(prompt.user).toContain("[본문]\n본문 하나")
  })

  it("leaves the setting block out when there are no facts", () => {
    expect(DraftConsistencyPrompt.build("본문 하나", []).user).not.toContain("[설정]")
  })
})
