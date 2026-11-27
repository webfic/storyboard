import { describe, expect, it } from "vitest"

import { SceneSectionExpansionPrompt, SkeletonFactsPrompt } from "@storyboard/story-ai"

describe("SkeletonFactsPrompt (#260)", () => {
  it.each(["generic", "xs"] as const)("asks for the facts the skeleton stated beyond the cards for the %s variant", (variant) => {
    const prompt = SkeletonFactsPrompt.build(
      { skeleton: "뼈대 본문", narrativeSource: "1. 만난다", castFacts: ["하나 — 설명: 전학생"] },
      variant
    )

    expect(prompt.system).toContain("[뼈대]")
    expect(prompt.user).toContain("[인물 사실]\n- 하나 — 설명: 전학생")
    expect(prompt.user).toContain("[이 장면의 사건]\n1. 만난다")
    expect(prompt.user).toContain("[뼈대]\n뼈대 본문")
  })

  it("hands the fixed facts to the expansion as their own block", () => {
    const base = { skeleton: "뼈대", section: "구간", targetLength: 100 }
    const withFacts = JSON.stringify(SceneSectionExpansionPrompt.build({ ...base, skeletonFacts: ["하나는 2년째 다닌다"] }))

    expect(withFacts).toContain("[뼈대가 정한 사실")
    expect(withFacts).toContain("- 하나는 2년째 다닌다")
    expect(JSON.stringify(SceneSectionExpansionPrompt.build(base))).not.toContain("[뼈대가 정한 사실")
  })
})
