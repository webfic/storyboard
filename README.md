# Storyboard

소설 한 편을 **기획 → 초안 → 검수 → 수정 → 원고 조립**까지 이어서 쓰도록 돕는 AI 창작 도구입니다.
같은 엔진을 세 가지 방식으로 씁니다 — VS Code 확장, 터미널 CLI, 텔레그램 봇.

English: [`README.en.md`](README.en.md) · 문서: [위키](https://github.com/webfic/storyboard/wiki) · 문의: [이슈](https://github.com/webfic/storyboard/issues)

> 이 저장소는 Storyboard의 **배포·문서·이슈** 저장소입니다. 소스 코드는 비공개입니다.

## 무엇을 하는 도구인가

작가는 **작품 목표와 판단**에 집중하고, 도구가 그 사이를 채웁니다.

| 단계 | 결과물 |
|---|---|
| 작품 계약 — 장르·독자층·시점·구성·목표 분량·금지 조건 | `.storyboard/project.json` |
| 아웃라인 — 시놉시스와 장·씬 계획 | `.storyboard/outline/` |
| 자료 카드 — 인물·배경·서술자 | `character/` `background/` `narrator/` |
| 씬 — "여기서 무슨 일이 일어나는가" | `scene/*.card` |
| 초안 — AI가 씬과 카드를 읽고 쓴 원고 | `draft/*.md` |
| 원고 — 장별 조립본, 검수 보고서, 장별 요약 | `manuscript/` |

폴더 하나가 작품 하나이고, 산출물은 전부 **읽을 수 있는 파일**입니다. 어느 단계든 열어 고치고 다시 돌릴 수 있습니다.

장편에서 앞뒤가 어긋나는 문제는 세 장치로 다룹니다 — 확정 설정만 모으는 **스토리 바이블**(canon),
씬을 넘어 상태를 이어 주는 **이야기 상태 원장**, 그리고 조립 원고를 통째로 읽는 **최종 검수**.

## 설치

> **첫 공개 릴리즈는 v0.9.0입니다.** 그 전까지 아래 명령은 받을 릴리즈가 없어 실패합니다.

**CLI와 텔레그램 봇** — Node 20 이상과 npm이 필요합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/webfic/storyboard/main/install.sh | bash
```

`~/.local/share/`에 풀고 `~/.local/bin/storyboard`·`~/.local/bin/storyboard-bot`을 링크하며, 체크섬을 검증하고
쓰는 셸(zsh/bash/fish)에 탭 완성을 등록합니다. 이미 tarball을 받아 두었다면 `./install.sh --from ~/Downloads`.

**VS Code 확장** — [릴리즈](https://github.com/webfic/storyboard/releases)에서 `storyboard-vscode-<version>.vsix`를 받아
`확장 > … > VSIX에서 설치`로 설치합니다.

## 시작하기

```bash
storyboard init --title "밤의 항해"   # 빈 디렉터리가 작품이 됩니다
storyboard setup                      # AI 프로바이더와 키 — 세 앱이 함께 씁니다
storyboard project set --genre …      # 아웃라인이 필요로 하는 작품 계약
storyboard doctor                     # 아직 빠진 것과, 그것을 채우는 명령
```

인자 없이 `storyboard`를 실행하면 대화형 화면이 열립니다. VS Code에서는 빈 폴더를 열고
`Storyboard: Initialize Project`부터 시작하세요.

자세한 사용법은 **[위키](https://github.com/webfic/storyboard/wiki)**를 보세요.

## 설정과 비밀

세 앱이 같은 파일을 씁니다.

| 파일 | 내용 |
|---|---|
| `~/.storyboard/config.json` | 프로바이더·모델·생성 옵션 (모든 작품 공통) |
| `<작품>/.storyboard/config.json` | 그 작품에서만 덮어쓸 값 |
| `~/.storyboard/secrets.json` | API 키 (`0600`) |
| `~/.storyboard/bot.json` | 텔레그램 봇 전용 설정 (`0600`) |

`STORYBOARD_HOME`으로 `~/.storyboard` 위치를 바꿀 수 있습니다.

## AI 프로바이더

API 키 방식은 OpenAI, Claude, Google Gemini, xAI Grok, Ollama를 지원합니다.
구독·계정 로그인만으로 쓰는 CLI 방식은 Claude Code(`claude`), Codex(`codex`), Gemini CLI(`gemini`)를 지원합니다.
`mock` 프로바이더는 키 없이 전체 흐름을 연습할 때 씁니다(초안 내용은 자리표시자).

## 문의

- **버그·기능 제안·질문** — [이슈](https://github.com/webfic/storyboard/issues)에 템플릿을 골라 남겨 주세요.
  버그는 `storyboard doctor` 출력이 함께 있으면 원인을 훨씬 빨리 찾습니다.
- **변경 내역** — [`CHANGELOG.md`](CHANGELOG.md) ([English](CHANGELOG.en.md))

## 라이선스

[Apache-2.0](LICENSE)
