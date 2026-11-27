import { describe, expect, it } from "vitest"

import { StoryStateUpdatePrompt, type StoryStateUpdateInput } from "@storyboard/story-ai"

describe("StoryStateUpdatePrompt golden", () => {
  const full: StoryStateUpdateInput = {
    sceneTitle: "3. 항구의 밤",
    draftBody: "엘리아가 항구에 도착했다.\n준이 그녀를 맞았다.",
    previousState: "- facts: 엘리아는 의사다\n- relations: 엘리아와 준은 존댓말",
    characterNames: ["엘리아 (별칭: 엘리)", "준"]
  }
  const bare: StoryStateUpdateInput = { sceneTitle: "1. 시작", draftBody: "본문만." }
  const emptyPrevious: StoryStateUpdateInput = { ...bare, previousState: "" }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(StoryStateUpdatePrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves the previous state out for the %s variant", (variant) => {
    expect(StoryStateUpdatePrompt.build(bare, variant)).toMatchSnapshot()
    expect(StoryStateUpdatePrompt.build(emptyPrevious, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("asks for the personal facts a scene fixed and lists the skeleton's facts for the %s variant (#260)", (variant) => {
    const prompt = StoryStateUpdatePrompt.build({ ...bare, skeletonFacts: ["엘리아는 항구에서 10년을 살았다"] }, variant)

    expect(prompt.system).toMatch(/신상/)
    expect(prompt.user).toContain("[뼈대가 정한 사실]\n- 엘리아는 항구에서 10년을 살았다")
    expect(StoryStateUpdatePrompt.build(bare, variant).user).not.toContain("[뼈대가 정한 사실]")
  })
})
