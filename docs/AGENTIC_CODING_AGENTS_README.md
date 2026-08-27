# Agentic Coding Agents: Research Context and Systems Design Survey

**Research context current through 27 August 2026.**

This document is a product-agnostic research handbook on autonomous and agentic software engineering systems. It is not a specification for any particular editor, repository, model, or commercial product. Its purpose is to preserve high-quality context about what the research literature and public industry engineering record actually say about coding agents, so that future design discussions do not repeatedly collapse into simplistic slogans such as “more agents are always better,” “one agent is enough,” “just add RAG,” or “simplify everything.”

The central conclusion of the literature is more nuanced:

> **Agentic coding performance is a property of a model–harness–environment system. Strong systems combine capable models with appropriate role specialization, high-signal repository interfaces, executable feedback, durable state, verification, security boundaries, observability, and evaluation. Complexity should be added where it creates a real separation of concerns or measurable capability, and removed where it merely creates redundant decisions, context, or coordination overhead.**

Two broad surveys help establish the scale of the field. Liu et al.'s *Large Language Model-Based Agents for Software Engineering: A Survey* collected **106 papers** and organized them from software-engineering and agent perspectives. A 2026 monograph, *Engineering Reliable Coding Agents: Evaluating and Operating the System Around the Model*, synthesizes **164 scholarly works, 100 practitioner records, 29 benchmark records, and 17 system case records**. This handbook does not pretend to reproduce every paper in those surveys; instead it synthesizes the recurring design lessons and directly annotates a large set of primary papers, benchmarks, and engineering reports.

---

## Contents

1. [Evidence policy and terminology](#1-evidence-policy-and-terminology)
2. [Executive synthesis](#2-executive-synthesis)
3. [What an agentic coding system is](#3-what-an-agentic-coding-system-is)
4. [From code generation to autonomous software engineering](#4-from-code-generation-to-autonomous-software-engineering)
5. [The core interactive agent loop](#5-the-core-interactive-agent-loop)
6. [The architecture spectrum](#6-the-architecture-spectrum)
7. [Role specialization](#7-role-specialization)
8. [Planning, decomposition, and project control](#8-planning-decomposition-and-project-control)
9. [Agent-computer interfaces and tool design](#9-agent-computer-interfaces-and-tool-design)
10. [Repository navigation, search, and retrieval](#10-repository-navigation-search-and-retrieval)
11. [Context engineering, memory, and durable state](#11-context-engineering-memory-and-durable-state)
12. [Execution environments, processes, and sandboxing](#12-execution-environments-processes-and-sandboxing)
13. [Verification, testing, review, and evaluator independence](#13-verification-testing-review-and-evaluator-independence)
14. [Multi-agent coordination and parallelism](#14-multi-agent-coordination-and-parallelism)
15. [Long-horizon execution and progress control](#15-long-horizon-execution-and-progress-control)
16. [Failure modes and anti-patterns](#16-failure-modes-and-anti-patterns)
17. [Training and reinforcement learning for coding agents](#17-training-and-reinforcement-learning-for-coding-agents)
18. [Benchmarks and evaluation](#18-benchmarks-and-evaluation)
19. [Public industry systems and convergent practices](#19-public-industry-systems-and-convergent-practices)
20. [What should be simplified—and what should not](#20-what-should-be-simplifiedand-what-should-not)
21. [A durable design checklist](#21-a-durable-design-checklist)
22. [Open research questions](#22-open-research-questions)
23. [Annotated bibliography](#23-annotated-bibliography)

---

## 1. Evidence policy and terminology

### 1.1 There is no single “industry standard” architecture

The term *agent* covers several distinct system designs. Anthropic's widely cited engineering taxonomy distinguishes **workflows**, where code determines the path through model calls and tools, from **agents**, where the model dynamically controls its own process and tool use. Research papers use the word even more broadly: some systems are essentially fixed pipelines with model components, while others are open-ended loops with memory, planning, self-reflection, tool use, and multiple interacting models.

Accordingly, this document uses **industry convergence** rather than *industry standard* when describing recurring practices. The field is moving too quickly, models differ too much, and workload-specific tradeoffs are too important for one architecture to be universally correct.

### 1.2 Evidence is not equally mature

This handbook gives greatest weight to:

1. peer-reviewed conference and journal papers;
2. well-described arXiv papers with executable evaluations;
3. engineering reports from organizations operating coding agents at scale;
4. product documentation that reveals concrete architecture or operational practices;
5. very recent preprints, treated as provisional evidence rather than settled findings.

Historical benchmark numbers are reported as **results at publication time**, not current leaderboard claims. Agentic coding scores change rapidly and are extremely sensitive to model version, harness, token/tool budget, environment, retries, and benchmark quality.

### 1.3 The unit of analysis is the system, not just the model

A coding agent should be understood as at least:

- a model or set of models;
- a control loop or workflow;
- prompts and tool schemas;
- repository navigation and retrieval;
- an execution environment;
- editing primitives;
- process and runtime control;
- memory/state management;
- verification and evaluation;
- security/permission boundaries;
- orchestration and scheduling;
- telemetry and observability.

The 2026 monograph *Engineering Reliable Coding Agents* makes this system-level point explicit: apparent model failures can originate in retrieval, state, execution, permissions, verification, or observability. Agentic Harness Engineering similarly reports that, in its experiments, harness improvements localized more strongly to tools, middleware, and long-term memory than to system-prompt changes.

---

## 2. Executive synthesis

The literature and public engineering record support the following durable conclusions.

### 2.1 A coding agent is not merely a code-generating model

Traditional benchmarks such as HumanEval test whether a model can emit a correct function. Real software engineering requires **repository understanding, action selection, editing, execution, feedback interpretation, iteration, and verification**. SWE-bench was influential precisely because it changed the unit of work from isolated code generation to modifying a real repository in response to a natural-language issue.

### 2.2 The harness is a first-class capability layer

SWE-agent demonstrated that the interface exposed to the model—the **Agent-Computer Interface (ACI)**—can materially alter performance. OpenAI and Anthropic's engineering reports reinforce the same point in production: repository layout, tools, sandboxing, browser/runtime observability, tests, and state handoffs determine what models can accomplish reliably.

A stronger model does not make harness design irrelevant. Conversely, harness assumptions can become stale as models improve. Good architectures keep stable environment/tool contracts while allowing planning, prompting, context management, and model routing to evolve.

### 2.3 Specialization is legitimate; bureaucracy is not

There is substantial evidence for role specialization:

- MASAI uses modular sub-agents with different objectives and strategies.
- AgentCoder separates programmer, test designer, and test executor.
- HyperAgent uses Planner, Navigator, Code Editor, and Executor roles.
- SpecRover adds a reviewer that vets intent and patches.
- ChatDev and MetaGPT model software-development roles and intermediate artifacts.
- Anthropic's long-running application harness uses **planner, generator, evaluator**.
- Anthropic's production research architecture uses an **orchestrator-worker** pattern.
- OpenAI publicly describes multi-agent Codex workflows, parallel worktrees, agent-to-agent review, and continuous task orchestration.

What the evidence does **not** imply is that the model should manually perform orchestration bookkeeping. Polling worker status, maintaining queues, retrying transport failures, persisting outputs, granting leases, or serializing state are usually better handled deterministically by the runtime.

The useful principle is:

> **Preserve semantic specialization; automate coordination mechanics.**

### 2.4 Single-agent and fixed-workflow systems remain essential baselines

Agentless is an important counterweight to maximalist agent architectures. Its localization → repair → validation pipeline deliberately removed free-form action choice and performed strongly on SWE-bench Lite at publication. SWE-agent likewise shows that a strong single interactive agent with a carefully designed interface can be formidable.

Therefore multi-agent complexity should not be added merely because it sounds “agentic.” It should earn its cost through parallelism, independent evaluation, role-specific context, model specialization, or measurable improvements.

### 2.5 Repository interfaces should be code-aware and high-signal

Research supports several complementary retrieval modes:

- lexical/name search;
- targeted file reads;
- symbol/definition/reference navigation;
- AST/program-structure search;
- fault localization from tests;
- iterative retrieval-generation;
- graph-based retrieval over code relationships.

AutoCodeRover explicitly argues against treating a repository as an undifferentiated collection of text files. RepoNavigator provides an interesting opposite lesson: **a small number of structurally grounded tools can outperform a sprawling retrieval surface**. The synthesis is not “use semantic search everywhere” or “never use retrieval”; it is “give the agent the smallest set of retrieval primitives that preserve the structure relevant to software reasoning.”

### 2.6 Context is a scarce computational resource

Irrelevant context can degrade reasoning. Long tool descriptions, verbose histories, duplicate state, and overlapping instructions compete with the actual problem. Anthropic's context-engineering guidance frames the problem as selecting the highest-value tokens at each inference step rather than maximizing context volume.

For coding agents this means:

- do not dump entire repositories into context;
- do not expose every tool to every role;
- do not repeat stable policies every turn;
- retrieve just-in-time;
- compress observations and tool output;
- persist durable state outside the model window.

### 2.7 Long-running agents need durable state outside chat

Hours- or days-long work spans context windows and often process lifetimes. Anthropic's long-running harness work uses structured artifacts and handoffs so fresh sessions can resume. MemGPT provides the broader conceptual precedent of hierarchical memory/context management.

The durable state of a coding project should usually include:

- original requirements and acceptance criteria;
- decomposition/task graph;
- completed and remaining work;
- key architectural decisions;
- files/modules currently relevant;
- known defects and failed approaches;
- last valid verification evidence;
- runtime/process state where needed;
- dependencies or external facts that materially affect the project.

Raw conversation history is not a robust project database.

### 2.8 Verification should be independent where independence matters

Tests and static diagnostics are deterministic and should be handled by the harness whenever possible. LLM evaluators are useful for criteria that cannot be encoded mechanically, but an implementation agent should not be the sole authority on whether its own work is correct.

AgentCoder, SpecRover, SWE-Gym, RepoAudit, Anthropic's evaluator architecture, and OpenAI's agent-to-agent review practices all provide different forms of **separation between generation and checking**.

### 2.9 Long-running is not the same as runaway

Public industry reports now describe individual coding-agent tasks lasting hours and project orchestration lasting days or weeks. OpenAI reports single Codex runs exceeding six hours; Anthropic explicitly studies multi-hour autonomous application generation and large parallel agent teams.

This argues against treating a short wall-clock limit as the primary safety/control mechanism for ambitious coding agents. A better operational distinction is:

- **productive long trajectory**: requirements are being completed, code changes occur, failures change, verification advances;
- **runaway trajectory**: equivalent observations repeat, the same verification is re-run without relevant mutation, failure signatures recur with no new strategy, context churn grows, or coordination activity dominates implementation.

Time and step counts remain useful telemetry and emergency safeguards, but progress-based watchdogs are generally better aligned with the actual goal.

### 2.10 Security should be enforced by technical boundaries, not endless approval prompts

Coding agents need enough freedom to build, run, test, install project dependencies, launch local services, and inspect runtime behavior. Asking a human to approve every low-risk action destroys autonomy and can create approval fatigue.

Anthropic and OpenAI both publicly emphasize sandboxing, filesystem/network boundaries, scoped credentials, and agent-native telemetry. The general security objective is **high autonomy inside a bounded workspace; explicit review for actions that cross the boundary**.

---

## 3. What an agentic coding system is

An agentic coding system differs from an ordinary coding assistant because it closes the loop between **intent and environment**.

A completion model has a simple interaction pattern:

```text
context -> model -> code suggestion
```

An agentic coding system instead resembles:

```text
goal
  ↓
interpret / plan
  ↓
inspect repository and environment
  ↓
choose action
  ↓
edit / execute / search / inspect
  ↓
observe result
  ↓
update state and strategy
  ↓
repeat
  ↓
verify
  ↓
deliver
```

The model is therefore not just predicting code. It is performing **sequential decision-making under partial information**. The environment changes after actions. Tests fail for reasons that were not present in the prompt. A dependency may be absent. The relevant implementation may live in an unexpected module. A browser may render while static diagnostics still fail. Another agent may finish a parallel task. These observations should alter the next decision.

ReAct established the general reasoning-and-acting pattern: reasoning can update plans and handle exceptions, while actions gather information from the environment. Toolformer demonstrated that choosing *whether, when, and how* to call tools is itself a learned capability. CodeAct investigated executable code as a unified action space rather than a large collection of rigid JSON actions.

For software engineering specifically, this interaction must encompass more than a shell. A credible coding agent usually needs to perceive at least:

- repository structure;
- source and configuration contents;
- dependency/build metadata;
- tests and test output;
- compiler/typechecker/linter diagnostics;
- version-control state where relevant;
- local application/runtime output;
- browser/DOM/console state for UI work;
- project-specific documentation and conventions.

Its actions typically include:

- searching/navigating;
- reading;
- writing/patching;
- running commands;
- starting/stopping project processes;
- executing tests/builds;
- querying documentation or the web;
- delegating bounded work;
- recording or updating durable project state.

The distinction between “tool” and “environment” is partly architectural. A deterministic harness may automatically run diagnostics after a mutation rather than making the model call a `diagnostics` tool. Likewise, scheduling a worker or persisting a checkpoint need not be model actions at all.

That leads to one of the most important design questions in agent engineering:

> **Which decisions genuinely require language-model judgment, and which are better represented as deterministic runtime invariants?**

---

## 4. From code generation to autonomous software engineering

The evolution of coding systems can be understood in stages.

### 4.1 Isolated generation

Benchmarks such as HumanEval and MBPP emphasize generating a self-contained function from a prompt. These remain useful for measuring local synthesis ability, but do not capture repository navigation, environment interaction, or long-horizon repair.

### 4.2 Repository-aware generation

RepoBench, CrossCodeEval, and RepoCoder established that cross-file information matters even before full autonomy. Repository-level completion requires finding relevant definitions, usages, APIs, and patterns outside the current file.

### 4.3 Interactive issue resolution

SWE-bench changed the problem: given a real repository and issue, produce a patch that passes tests. SWE-agent, AutoCodeRover, Agentless, MASAI, CodeR, OpenHands, SpecRover and later systems explored different ways to navigate, edit, execute, test, and iterate.

### 4.4 Long-horizon engineering

Newer benchmarks and industry systems broaden the target beyond single issue repair. SWE-EVO evaluates evolution tasks touching many files and hundreds of tests. SWE-Lancer includes paid freelance engineering work. PaperBench requires replicating complete research results. MLE-bench requires iterative machine-learning experimentation. DeepSWE deliberately creates original long-horizon tasks whose solutions are not upstreamed.

This shift matters because a system optimized for a 20-minute bug fix can fail spectacularly on a six-hour product build. Long-horizon work amplifies:

- context management;
- project-state persistence;
- decomposition quality;
- process lifecycle management;
- regression risk;
- evaluator reliability;
- recovery from interruptions;
- coordination across subprojects.

The frontier is therefore moving from “can the model patch this issue?” toward “can the system carry an engineering objective across an extended sequence of decisions without losing the plot?”

---

## 5. The core interactive agent loop

A useful abstraction is:

```text
OBSERVE -> ORIENT -> DECIDE -> ACT -> VERIFY/LEARN -> repeat
```

The exact labels vary across papers, but the recurring mechanics are stable.

### 5.1 Observation

Observation should be **purposeful**, not indiscriminate. Reads, searches, build output, test results, runtime logs, and browser state are evidence. Each observation should reduce uncertainty or test a hypothesis.

Excessive observation is a known failure pattern. The 2025 empirical study *Understanding Code Agent Behaviour* reports that failed trajectories were consistently longer and more variable than successful ones. Importantly, even failed runs often localized the problematic files correctly; the hard part was making an effective modification.

### 5.2 Orientation and state

The system integrates new evidence with:

- goal;
- current project state;
- known constraints;
- previous successful/failed actions;
- active subtask;
- verification state.

This state need not all live in prompt text. Much of it can be stored in structured runtime objects and selectively rendered into context.

### 5.3 Decision

The model selects the next semantically meaningful action: inspect another definition, patch a file, run a focused test, delegate an independent investigation, or finish.

Decision quality degrades when there are too many overlapping choices. ToolScope and JTPRO provide direct evidence that redundant/ambiguous tool inventories and under-specified schemas reduce tool-selection reliability.

### 5.4 Action

Actions should be coarse enough to match the model's capabilities. A tool interface designed like a low-level REST API may force the model to perform deterministic plumbing. Conversely, a tool that bundles too much hidden behavior can make failures opaque.

SWE-agent's ACI work and Anthropic's tool-design guidance converge on the need to design tools *for agents*, not simply expose existing APIs one-for-one.

### 5.5 Verification and adaptation

A successful command is not necessarily a successful task. The agent should distinguish:

- “the command ran”;
- “the file changed”;
- “the relevant test passed”;
- “the full acceptance condition passed”;
- “the user-visible behavior is correct.”

When verification fails, the next action should be conditioned on the failure, not blindly repeat the same check. Reflexion and Self-Refine provide general feedback/refinement mechanisms; software-specific systems make feedback more objective through compilers, tests, execution, and independent reviewers.

---

## 6. The architecture spectrum

It is a mistake to treat architecture as a binary choice between “single agent” and “multi-agent.” Practical systems lie on a spectrum.

### 6.1 Deterministic or mostly fixed pipelines

**Agentless** deliberately removes open-ended control and uses three phases: localization, repair, validation. This improves interpretability and constrains action space. Fixed pipelines are attractive when task structure is predictable and the model is more reliable at individual transformations than at long-term control.

Advantages:

- easier debugging and attribution;
- lower coordination overhead;
- reproducible execution;
- bounded context;
- fewer opportunities for tool misuse.

Limitations:

- poor fit for tasks whose required subtasks are not known in advance;
- brittle when environment feedback demands a different strategy;
- difficult to generalize across heterogeneous engineering work.

### 6.2 Single generalist interactive agent

**SWE-agent** and generalist platforms such as **OpenHands** demonstrate the power of one model interacting repeatedly with a repository and execution environment.

Advantages:

- one coherent context and task owner;
- low inter-agent communication cost;
- simple attribution;
- strong fit for local issue repair.

Limitations:

- long trajectories can exhaust or pollute context;
- one agent must switch between exploration, implementation, testing, and review;
- independent parallel work is unavailable;
- self-evaluation can be correlated with generation mistakes.

### 6.3 Modular sequential specialists

**MASAI**, **AgentCoder**, **HyperAgent**, **MapCoder**, **CodeSim**, **ChatDev**, and **MetaGPT** decompose the work into roles or phases.

This can reduce cognitive interference: a navigator can receive repository-search tools without edit tools; an executor can focus on mutation; a test designer can produce adversarial tests; a reviewer can inspect a patch without inheriting the executor's full trajectory.

The benefit comes from **different objectives, context, strategies, or tools**. Merely giving the same model five names and making the instances repeat each other's work is not meaningful specialization.

### 6.4 Orchestrator-worker architectures

A central orchestrator dynamically decomposes a task, starts workers, and integrates results. Anthropic explicitly recommends this pattern for complex coding tasks where the number and nature of files/subtasks cannot be predicted in advance. Its production multi-agent research system uses an orchestrator-worker pattern with parallel subagents.

The orchestrator should own:

- global goal;
- decomposition;
- dependency graph;
- worker assignment;
- conflict resolution;
- integration decisions;
- stopping/completion.

Workers should return **artifacts and evidence**, not endless conversational chatter.

### 6.5 Planner-generator-evaluator

Anthropic's 2026 long-running application work reports a three-agent architecture:

1. **planner**: decomposes requirements and prevents underscoping;
2. **generator**: implements the project;
3. **evaluator**: judges output against explicit criteria.

This architecture is notable because it separates **task definition**, **production**, and **quality judgment**—three roles that are easily entangled in a monolithic agent.

### 6.6 Search/tree/debate architectures

SWE-Search combines a SWE agent with value and discriminator agents in an MCTS process. Cross-Team Collaboration explores multiple team-level decision paths. These architectures treat software engineering as a search problem where multiple candidate trajectories can be evaluated.

They can be valuable near model capability limits, but have higher inference cost and require careful credit assignment. They should not be assumed to dominate simpler systems for every workload.

### 6.7 Large parallel teams

Anthropic's 2026 C-compiler experiment is an extreme public example: 16 Claude instances, almost 2,000 sessions, and a roughly 100,000-line Rust compiler capable of building Linux on multiple architectures. The experiment demonstrates that agent teams can expand feasible project scope, but also makes the coordination challenge explicit: tests, task decomposition, shared-codebase management, and harness design become central.

---

## 7. Role specialization

Role names are not standardized. What matters is **functional separation**.

### 7.1 Orchestrator / lead

Primary responsibility: preserve global objective coherence.

Typical inputs:

- complete requirements;
- project-state summary;
- worker results;
- evaluator findings;
- architectural constraints.

Typical actions:

- decompose;
- reprioritize;
- assign;
- integrate;
- decide when further investigation is required;
- decide whether acceptance criteria are satisfied.

A lead should avoid spending most of its context on raw file output. If the lead becomes the main grep/read/edit worker, specialization has collapsed.

### 7.2 Planner

Planning can be a role, a phase, or a capability of the orchestrator. It is most useful when the task has multiple interacting requirements, sequencing matters, or “working code” can still omit substantial requested functionality.

Planning output should be concrete and inspectable:

- requirements;
- milestones;
- dependencies;
- acceptance criteria;
- risk areas.

A plan is not valuable merely because it is long.

### 7.3 Scout / investigator / navigator

This role reduces uncertainty.

Useful specializations include:

- repository navigator;
- fault localizer;
- external-documentation researcher;
- dependency investigator;
- architecture mapper.

The scout should be predominantly read-only. Because it has a narrow objective, it can use a smaller context and possibly a smaller/faster model. MASAI explicitly cites gathering information from scattered repository sources as an advantage of sub-agent modularity. HyperAgent formalizes a Navigator role.

### 7.4 Executor / builder / code editor

The executor owns mutation:

- implementation;
- refactoring;
- configuration;
- targeted tests;
- local debugging.

It should receive enough context to act without redoing the scout's work, but not an indiscriminate dump of all research. Its output should include the change and relevant evidence.

### 7.5 Test designer

AgentCoder's test designer demonstrates why test generation can deserve a separate objective. The implementation agent has an incentive—implicit or explicit—to make its current design pass. A test-design role can instead search for edge cases, invalid assumptions, and missed requirements.

This role is especially useful when:

- specifications are richer than existing tests;
- hidden edge cases matter;
- generated code lacks a mature test suite.

### 7.6 Test executor / verification worker

Execution itself is largely deterministic, but a dedicated worker can manage:

- test selection;
- environment setup;
- failure triage;
- reproducer generation;
- performance measurements.

The deterministic runtime should still execute commands; the “agent” portion is selecting and interpreting the right checks.

### 7.7 Evaluator / reviewer / verifier

This role judges whether the work actually satisfies the objective. Useful independence mechanisms include:

- fresh context;
- read-only permissions;
- criteria supplied independently of implementation reasoning;
- access to diff, tests, diagnostics, and runtime behavior;
- ability to reject partial completion.

SpecRover uses a reviewer to vet intent and patches. RepoAudit uses a validator to check inferred data-flow facts and path feasibility. Anthropic's evaluator exists specifically because the generator can miss quality criteria, especially near capability boundaries.

### 7.8 Security and approval controller

Security policy is often best implemented **outside the LLM role system**. A language model may explain or classify a risky request, but filesystem/network isolation, credential scoping, path restrictions, command policy, and audit logging should be deterministic where possible.

---

## 8. Planning, decomposition, and project control

Long-horizon coding is fundamentally a **project-control problem** as well as a coding problem.

### 8.1 Requirements must survive implementation

A common failure mode is “local success, global incompleteness”: the agent fixes the first concrete problem it encounters and then treats that as completion.

For complex projects, the harness should preserve a canonical representation of requirements and acceptance criteria that survives context resets and worker handoffs.

### 8.2 Decomposition should follow dependency structure

Subtasks are most useful when they are:

- semantically coherent;
- independently verifiable where possible;
- assigned with explicit inputs/outputs;
- ordered by dependency when necessary;
- parallelized only when they are truly independent.

Poor decomposition creates integration debt. A task such as “implement database schema, API, UI, and tests” may have dependencies that make blind parallelization wasteful. Conversely, repository investigation and documentation research can often run in parallel.

### 8.3 Plans should be living state, not sacred scripts

Environment feedback may invalidate a plan. ReAct's central idea—interleaving reasoning and environment action—is directly relevant: planning must remain revisable.

Useful plan states include:

- pending;
- active;
- blocked;
- complete;
- invalidated/superseded.

The runtime can maintain these deterministically. The LLM need not spend tool calls formatting a task manager unless doing so genuinely improves reasoning.

### 8.4 Structured intermediate artifacts reduce information loss

MetaGPT's SOP/intermediate-artifact design, Anthropic's long-running harness artifacts, and many multi-agent systems converge on a useful principle: **handoffs should have schemas**.

A scout handoff might contain:

```text
finding
evidence
files/symbols
confidence
open_questions
recommended_next_action
```

An executor handoff might contain:

```text
objective
files_changed
behavior_changed
tests_run
results
remaining_risks
```

A reviewer handoff might contain:

```text
criterion
status
evidence
severity
required_fix
```

This is much more robust than “tell the next agent everything you know.”

---

## 9. Agent-computer interfaces and tool design

### 9.1 Tool design is part of model capability

SWE-agent's central ACI result is foundational: the same underlying model can perform differently depending on how repository navigation, editing, and execution are exposed.

A useful tool surface should minimize accidental complexity.

### 9.2 Tools should match semantic actions

Bad tool design often mirrors an internal API rather than an agent's task. The agent then has to infer low-level call sequences that deterministic software could handle.

Good tools expose operations such as:

- find symbol;
- search text;
- read lines;
- apply patch;
- run command;
- inspect local app;
- run targeted tests.

### 9.3 More tools can make the agent worse

ToolScope finds that overlapping names/descriptions reduce selection accuracy and reports substantial gains from merging redundant tools and retrieving only relevant ones. JTPRO likewise reports errors from large domain-specific inventories with ambiguous descriptions and under-specified arguments.

This supports **role-specific or dynamically filtered tool surfaces**.

It does *not* imply that a capable agent should have only one tool. RepoNavigator's “one tool” result is task-specific: its single execution-aware jump-to-definition action is structurally rich and was trained with RL for repository localization. The broader lesson is to reduce *overlapping control choices*, not to fetishize a tool count.

### 9.4 Tool output should be bounded

An agent can be overwhelmed by a successful tool. Returning a 100,000-line log is functionally similar to a failed retrieval operation.

Useful policies include:

- default result caps;
- pagination;
- grep/pattern modes;
- tail/head access;
- summarized command output plus raw-output handles;
- failure-focused test output;
- structured diagnostics.

### 9.5 Dynamic tool discovery can scale larger ecosystems

If an agent must access hundreds or thousands of tools, injecting every schema into context is not tenable. Tool retrieval, namespaces, hierarchical tool servers, or code-mediated execution can defer tool details until needed. Anthropic's “advanced tool use” work and MCP-Flow address this broader scaling problem.

For a focused coding agent, however, a compact native development toolset is usually preferable to needing a tool-search agent merely to find `read_file`.

---

## 10. Repository navigation, search, and retrieval

Repository retrieval is one of the most contested parts of coding-agent architecture because several apparently contradictory results are all true under different conditions.

### 10.1 Lexical search is extremely powerful

Identifiers, filenames, imports, error messages, test names, route paths, and configuration keys are naturally lexical. Fast grep/ripgrep-style search is cheap, transparent, and easy for models to reason about.

Anthropic publicly describes Claude Code as combining repository instructions with just-in-time tools such as glob and grep rather than requiring all repository knowledge to be pre-indexed.

### 10.2 Cross-file context is genuinely necessary

RepoBench and CrossCodeEval show that single-file context is insufficient for many code-completion tasks. Relevant definitions and conventions often live elsewhere.

RepoCoder shows iterative retrieval-generation improving over simple in-file baselines. These results support repository-aware retrieval even if the implementation is simple.

### 10.3 Program structure adds signal

AutoCodeRover searches using classes and methods over an AST, explicitly arguing that a software project should not be treated merely as a bag of files. It also uses spectrum-based fault localization when tests are available.

GraphCoder models control-flow and data/control dependencies in a code-context graph. RepoNavigator uses an execution-aware definition-jump primitive. These systems support code-aware retrieval primitives such as:

- definitions;
- references;
- call relationships;
- symbols;
- AST structure;
- dependency/import graph;
- test-to-code coverage/fault-localization signals.

### 10.4 Semantic retrieval is optional, not foundational law

Embedding-based retrieval can be useful for natural-language concepts, architectural documentation, or repositories with inconsistent terminology. But generic semantic similarity is not equivalent to program relevance. A chunk can be semantically similar while being irrelevant to the actual call path.

The evidence supports evaluating retrieval by downstream engineering success, not by retrieval novelty.

### 10.5 Retrieval should be iterative

A realistic sequence might be:

```text
issue mentions "session refresh"
    ↓
text search for refresh/session symbols
    ↓
read route and tests
    ↓
follow definition/reference
    ↓
observe actual call path
    ↓
retrieve only newly relevant modules
```

This is superior to retrieving a static top-k bundle once and assuming it contains all necessary context.

### 10.6 Search should preserve provenance

Every retrieved result should preserve:

- path;
- symbol or line range;
- query/reason;
- whether the content is current;
- enough surrounding context to interpret it.

This allows both model and evaluator to verify claims against source.

---

## 11. Context engineering, memory, and durable state

### 11.1 Context is working memory, not storage

Anthropic's context-engineering formulation is useful: the engineering problem is choosing the most useful tokens for the next inference. The full historical universe of a task should not be copied into every turn.

Irrelevant-context research shows that additional unrelated information can materially reduce model accuracy. A very recent 2026 preprint on compositional constraints further suggests that satisfying many simultaneous explicit constraints degrades sharply; because that result is new, it should be treated as supporting evidence rather than a universal law.

### 11.2 Context should have layers

A mature agent system often benefits from:

**Stable instructions**
- role;
- safety;
- basic operating principles.

**Active task state**
- current objective;
- relevant requirements;
- blockers;
- immediate plan.

**Retrieved evidence**
- files;
- test output;
- docs;
- worker results.

**Recent trajectory**
- only enough actions to avoid repetition and interpret current state.

**Durable external state**
- everything needed across context resets, stored outside prompt history.

### 11.3 Memory should be typed

“Memory” is too broad. Useful categories include:

- **episodic**: what happened in earlier attempts;
- **semantic**: project facts and architecture;
- **procedural**: reusable workflows/skills;
- **task state**: requirements, progress, blockers;
- **environment state**: running services, dependencies, versions.

Reflexion stores linguistic reflections in episodic memory. MemGPT proposes hierarchical memory tiers and virtual context. Voyager stores reusable executable skills. Long-running coding harnesses typically need task/project state more urgently than free-form autobiographical memory.

### 11.4 Compaction versus fresh-session handoff is model-dependent

Compaction preserves continuity but can recursively summarize errors. Fresh sessions reduce context contamination but risk losing tacit knowledge. Anthropic's long-running work has used structured handoffs and context resets, while later Managed Agents guidance explicitly warns that harness assumptions can go stale as models improve.

Therefore context strategy should be **replaceable and evaluated**, not encoded as a permanent truth.

### 11.5 The project ledger is more important than chat memory

For autonomous engineering, a durable project ledger should answer:

- What is the user ultimately asking for?
- What requirements are objectively complete?
- What remains?
- What changed?
- What failed?
- What must not be repeated?
- What was verified, on which code generation/state?
- What decisions are important for future work?

This ledger can survive model swaps, crashes, context resets, and parallel-worker turnover.

---

## 12. Execution environments, processes, and sandboxing

### 12.1 Agents need real execution

Software correctness is largely empirical. Compilers, tests, servers, package managers, browsers, and CLIs provide ground truth that static language-model reasoning cannot replace.

OpenHands emphasizes code, CLI, and web interaction in sandboxed environments. SWE-bench itself requires executable repository environments.

### 12.2 The environment should be reproducible

A good coding harness controls:

- repository revision;
- language/toolchain versions;
- installed dependencies;
- environment variables;
- network policy;
- test commands;
- process lifecycle;
- filesystem permissions.

Otherwise “agent performance” can actually measure machine drift.

### 12.3 Long-running agents need process ownership

A project may need:

- dev server;
- database;
- worker process;
- browser session;
- test watcher.

The harness should track these as structured resources with PID/port/status/log handles rather than requiring the model to rediscover them repeatedly via `ps`, `lsof`, or speculative port scans.

### 12.4 Sandboxing increases autonomy

Anthropic reports that filesystem and network sandboxing reduced permission prompts by 84% in internal Claude Code usage. The deeper principle is that security boundaries can **increase** agency: inside a constrained workspace the model can run commands without interrupting the user for every operation.

OpenAI similarly describes managed configuration, constrained execution, network policies, and agent-native logging for Codex deployments.

### 12.5 Least privilege should follow roles

A reviewer may need read + test permissions but not write access. A scout may need search/read/web but not mutation. An executor may need workspace write and project execution but no access to unrelated home-directory secrets.

Role separation can therefore improve security as well as reasoning.

### 12.6 Version control is an architectural choice, not a universal prohibition

There is no industry rule that coding agents should never use Git. OpenAI uses isolated worktrees and cloud workspaces; other systems use branches or patch artifacts. Safe designs can allow commits inside isolated repositories while preventing destructive access to unrelated state.

The invariant should be **reversible, isolated, auditable change**, not a universal ban on a particular Git subcommand.

---

## 13. Verification, testing, review, and evaluator independence

### 13.1 Verification is a stack

A robust system does not equate “test command exited zero” with “project complete.”

Evidence layers can include:

1. syntax/parse;
2. typecheck/compile;
3. static analysis/lint;
4. targeted unit tests;
5. integration tests;
6. end-to-end tests;
7. runtime logs/health;
8. browser DOM/console/screenshots for UI;
9. performance/resource criteria;
10. independent requirement evaluation.

Different projects require different subsets.

### 13.2 Verification evidence must correspond to the current code state

A test that passed before a later mutation is stale evidence. Harnesses should associate verification with a code generation, diff, commit, or mutation epoch.

This simple state-management rule prevents a common agent error: making a change after tests pass and then finishing as though the earlier tests validate the new state.

### 13.3 Tests are not infallible specifications

OpenAI's benchmark audits are a strong caution. SWE-bench Verified was created by human review to remove underspecified or incorrectly graded tasks, yet OpenAI later stopped treating it as a frontier signal after finding residual test/design problems and contamination. In July 2026 OpenAI audited SWE-Bench Pro and estimated roughly 30% of tasks were broken, citing overly strict tests, underspecified prompts, low test coverage, and misleading prompts.

The systems lesson is broader than benchmark design:

> **Tests are evidence about requirements, not automatically the complete definition of requirements.**

An agent should not knowingly violate a clear user requirement merely to satisfy an incorrect or overly narrow test.

### 13.4 Independent evaluation helps at the capability edge

Self-Refine shows that a model can improve its own output with feedback. But correlated self-evaluation has obvious limitations. Independent evaluators can bring:

- fresh context;
- different prompt/objective;
- stronger model;
- read-only stance;
- adversarial criteria.

SpecRover's reviewer, RepoAudit's validator, SWE-Gym's learned verifiers, and Anthropic's evaluator all instantiate this separation differently.

### 13.5 Evaluators themselves need evaluation

An LLM judge can be biased, inconsistent, or persuaded by plausible explanations. PaperBench therefore includes a benchmark for its judge. OpenAI's benchmark audits combine agents and experienced engineers rather than assuming a judge is ground truth.

Whenever possible, prefer deterministic or execution-based criteria. Use LLM evaluation for properties that genuinely require semantic judgment, and calibrate it against humans or known outcomes.

---

## 14. Multi-agent coordination and parallelism

### 14.1 Multi-agent systems are valuable when work decomposes

The clearest benefits are:

- parallel independent investigation;
- role-specific tools/context;
- fresh independent review;
- model specialization;
- search over multiple solution paths;
- isolation of large subproblems.

Anthropic's production research system reports large gains on breadth-first tasks by spawning parallel research subagents. The lesson transfers naturally to coding tasks with independent modules, investigations, or reviews.

### 14.2 Coordination has real costs

Multi-agent systems create:

- duplicated exploration;
- inconsistent assumptions;
- merge conflicts;
- communication overhead;
- task overlap;
- stale shared state;
- unclear ownership;
- cascading hallucinations;
- expensive evaluation/credit assignment.

MetaGPT explicitly motivates SOPs partly as a response to cascading hallucinations in naive agent chains. Anthropic's multi-agent engineering report similarly calls out coordination, evaluation, and reliability challenges.

### 14.3 The runtime should own mechanics

A strong orchestration API should not force the lead LLM to perform:

```text
list workers
check availability
create task
poll status
poll status again
request result
download long result
mark worker free
update queue
```

The lead should issue semantically meaningful directives such as:

```text
investigate authentication failure
implement API endpoint after schema task
review current patch against requirements
```

The runtime can own:

- worker lifecycle;
- queueing;
- completion signals;
- output persistence;
- retries;
- timeouts;
- cancellation;
- task dependencies;
- workspace isolation.

### 14.4 Shared code requires isolation or ownership

Parallel edits to the same working tree are a conflict factory. Public systems increasingly use isolated worktrees/workspaces or explicit file/task ownership. OpenAI's Codex app documents worktrees so agents can work on the same repository without touching each other's local Git state.

### 14.5 Parallelism should follow the dependency graph

Good parallel candidates:

- independent repository investigations;
- docs research;
- test design;
- separate components with stable interfaces;
- review of completed work.

Bad parallel candidates:

- two agents redesigning the same schema;
- downstream implementation before upstream interface is known;
- multiple agents “fixing” the same failing test without coordination.

### 14.6 Multi-agent is not a substitute for better models or tools

More agents can multiply errors as readily as insights. The correct baseline comparison is often:

- better single agent + better ACI;
- fixed workflow;
- modular multi-agent;
- parallel multi-agent.

Use the cheapest architecture that reaches the reliability target on representative work.

---

## 15. Long-horizon execution and progress control

### 15.1 Long horizon is now an explicit target

Public engineering reports describe tasks lasting **hours, days, or weeks**. OpenAI's Codex app is explicitly positioned around long-running, parallel work; its harness-engineering report says individual Codex runs commonly exceed six hours. Anthropic's research explicitly studies multi-hour autonomous application development.

Therefore a serious autonomous coding architecture must assume:

- many model calls;
- multiple context windows;
- process restarts;
- provider errors;
- partial project completion;
- need for recovery.

### 15.2 Time is not a good primary stopping criterion

A two-hour task can be healthy. A two-minute loop can be pathological.

The harness should measure progress dimensions such as:

- requirements completed;
- successful source mutations;
- failing tests resolved;
- diagnostics reduced;
- evaluator findings closed;
- new useful evidence discovered;
- subtask completions;
- integration milestones.

### 15.3 Progress watchdogs are better than naive step budgets

Useful stall indicators include:

- repeated equivalent tool calls;
- many observations without a mutation when mutation is expected;
- same failed test signature after no relevant change;
- repeated browser inspection of unchanged application state;
- repeated context reset without project progress;
- cycling between the same files/hypotheses;
- repeated worker creation for the same unresolved question.

A watchdog should first trigger **strategy reconsideration**, not necessarily abort the whole project. For example:

```text
same failure repeated
    ↓
freeze repetition
    ↓
checkpoint current evidence
    ↓
ask lead/planner for a different hypothesis
    ↓
optionally escalate model or specialist
```

### 15.4 Hard limits still exist for safety/resources

Removing arbitrary task-duration limits does not mean unlimited everything. Systems still need:

- user cancellation;
- spending/API quotas;
- disk/memory limits;
- process limits;
- network boundaries;
- recursion/delegation caps;
- retry backoff;
- emergency circuit breakers.

These are resource and safety controls, distinct from treating “15 minutes” as evidence that a productive project should stop.

### 15.5 Checkpointing is part of the execution loop

Long-running tasks should checkpoint after meaningful milestones and before risky operations. Checkpoints should be compact enough to reload and rich enough to resume without re-investigation.

A good checkpoint is closer to a structured engineering handoff than a transcript summary.

---

## 16. Failure modes and anti-patterns

### 16.1 Observation loops

Symptoms:

- repeated reads of equivalent code;
- repeated browser inspection;
- repeated status/process checks;
- repeated searching with minor query variations.

Cause: uncertainty is not being converted into a hypothesis/action threshold.

Mitigation:

- observation budgets between mutations;
- evidence deduplication;
- explicit “what new fact will this call establish?” policies;
- better repository interfaces.

### 16.2 Verification loops

Symptoms:

- rerunning the same build/test without code/environment change;
- treating “verify again” as remediation;
- multiple agents independently rerunning identical checks.

Mitigation:

- verification tied to mutation epoch;
- cache valid evidence;
- block repeated unchanged checks;
- send failures to executor with concrete diagnostics.

### 16.3 Planning loops

Symptoms:

- repeated decomposition;
- “reviewing the plan” instead of executing it;
- planner and orchestrator duplicating each other.

Mitigation: only replan when assumptions or blockers materially change.

### 16.4 Self-certification

Symptoms:

- implementation agent declares success from plausible reasoning;
- browser rendering is treated as proof despite compiler errors;
- passing one test is generalized to all requirements.

Mitigation: objective gates + independent evaluation.

### 16.5 Tool shopping

Symptoms:

- list tools/resources;
- inspect permissions;
- discover launcher;
- query capability status;
- finally perform obvious action.

Mitigation: task- and role-specific tool surfaces; runtime resolves deterministic capability details.

### 16.6 Memory bureaucracy

Symptoms:

- model repeatedly writes chat memory, notes, summaries, TODOs;
- state-management calls outnumber engineering actions.

Mitigation: automatic structured state persistence. Memory should serve the agent, not become its job.

### 16.7 Overlong context

Symptoms:

- giant tool results;
- duplicated policies;
- full conversation replay;
- irrelevant skills/docs;
- dozens of tool schemas.

Mitigation: context curation, dynamic retrieval, output paging, durable external state.

### 16.8 Premature completion

Symptoms:

- first feature works, remaining requirements ignored;
- local fix passes, integration incomplete;
- TODOs/criteria not reconciled.

Mitigation: canonical requirements ledger + final evaluator.

### 16.9 Endless “one more retry”

Symptoms:

- every failure earns another complete autonomous session;
- nested wrappers each add their own remediation loops.

Mitigation: one owner for retry policy; retries must be conditioned on new evidence/strategy and governed by stall detection.

### 16.10 Over-specialization

Symptoms:

- multiple roles whose outputs are indistinguishable;
- each role repeats repository discovery;
- communication dominates work.

Mitigation: define each role by objective, context, tool permissions, and measurable contribution. Collapse roles that do not produce differentiated value.

---

## 17. Training and reinforcement learning for coding agents

### 17.1 Agent training differs from one-shot code training

Software agents interact with a **stateful environment**. Their quality depends not just on final code tokens but on sequences of:

- search;
- read;
- edit;
- execute;
- interpret;
- recover.

Training only on final patches cannot directly teach efficient tool choice or recovery.

### 17.2 SWE-Gym

SWE-Gym provides 2,438 executable software-engineering tasks and was used to train both agents and inference-time verifiers. The paper reported up to 19 percentage-point absolute gains on SWE-bench subsets, demonstrating that interactive trajectories can be a training substrate, not only an evaluation trace.

### 17.3 Long-context, multi-turn SWE reinforcement learning

A 2025 study trains Qwen2.5-72B in stateful software-engineering interactions and reports a SWE-bench Verified increase from 20% to 39% under its setup. The significance is architectural: the environment provides nontrivial observations after actions, so training must model the multi-turn interaction rather than a one-shot response.

### 17.4 Agent Lightning and harnessed agentic RL

The original Agent Lightning decouples arbitrary agent execution from RL training through a standardized interface. Agent Lightning v1.0, released in August 2026, goes further with the notion of **harnessed agentic RL**: the deploy-time harness owns tools, context, and environment interaction during training.

The v1.0 report is very recent and should be treated as provisional, but its result is especially relevant to small coding models: it reports Qwen3.5-9B improving from 41.8% to 56.4% on SWE-bench Verified using 6,000 training examples under the published workflow.

The deeper lesson is more important than the exact score:

> If deployment behavior depends on a harness, training against a materially different interaction loop may optimize the wrong agent.

### 17.5 Training and harness co-design

A role-specialized architecture opens further training questions:

- train scouts for localization/search efficiency;
- train executors for patch quality;
- train evaluators on false-positive/false-negative discrimination;
- train orchestrators on task decomposition and worker assignment;
- train tool calling with the exact schemas used at deployment.

This may be more sample-efficient than asking one small model to master every cognitive mode equally well.

---

## 18. Benchmarks and evaluation

### 18.1 SWE-bench

SWE-bench introduced 2,294 real GitHub issues across 12 Python repositories. It requires repository editing, long-context understanding, and execution, and became the dominant early benchmark for agentic software engineering.

### 18.2 SWE-bench Verified—and its cautionary history

OpenAI and the SWE-bench authors created a 500-task human-validated subset after reviewing 1,699 samples. Each sample was reviewed by multiple developers for underspecification and invalid tests.

By February 2026, OpenAI reported that Verified was no longer a useful frontier-launch metric because of contamination and residual evaluation flaws. This is an important example of benchmark half-life: a benchmark can be thoughtfully curated and still become stale as model capabilities and training corpora change.

### 18.3 SWE-Bench Pro—and another caution

SWE-Bench Pro expanded to 1,865 tasks across 41 repositories, including held-out and commercial sources, with longer-horizon work.

In July 2026 OpenAI reported an audit estimating roughly **30% of tasks were broken** and retracted its earlier blanket recommendation to use the benchmark. Problems included overly strict tests, underspecified prompts, low-coverage tests, and misleading instructions.

No benchmark should therefore be treated as an oracle.

### 18.4 SWE-Lancer

SWE-Lancer contains more than 1,400 freelance engineering/managerial tasks associated with roughly $1 million in real payouts. It broadens evaluation beyond mined GitHub bug fixes and includes substantial feature implementations.

### 18.5 SWE-PolyBench

SWE-PolyBench adds multi-language repository tasks in Java, JavaScript, TypeScript, and Python, covering bugs, features, and refactors. This addresses the risk of over-optimizing agent architecture for Python/SWE-bench conventions.

### 18.6 SWE-rebench

SWE-rebench builds an automated pipeline for continuously collecting fresh interactive software-engineering tasks, with more than 21,000 Python tasks reported in the paper. Freshness is important because static public benchmarks become training data.

### 18.7 SWE-EVO

SWE-EVO targets software evolution rather than isolated issue repair. Its 48 tasks average changes across 21 files and are validated by large test suites. The paper reports a large performance gap between SWE-EVO and SWE-bench Verified for the evaluated agents, highlighting the remaining long-horizon challenge.

### 18.8 DeepSWE

DeepSWE (2026) constructs 113 original tasks across 91 active repositories and five languages. Tasks are written from scratch and not upstreamed, while hand-written verifiers focus on requested functionality rather than the exact historical patch. This reflects the evaluation field's shift toward contamination resistance and implementation-agnostic grading.

### 18.9 PaperBench and MLE-bench

PaperBench requires agents to replicate 20 research papers and contains 8,316 gradable subtasks. MLE-bench evaluates 75 Kaggle competitions. These benchmarks matter because real autonomous engineering is often not “fix one bug”; it includes experimentation, scientific implementation, datasets, long runtimes, and ambiguous intermediate choices.

### 18.10 Evaluate the harness, not just the model

At minimum, serious coding-agent evaluations should report:

- model/version;
- harness/version;
- tool surface;
- repository interface;
- context/token limits;
- step/tool budgets;
- retries;
- parallel agents;
- sandbox/environment;
- network access;
- verification strategy;
- cost and wall time.

Otherwise a score cannot be attributed correctly.

### 18.11 Evaluate trajectories as well as final success

Useful operational metrics include:

- success / requirement completion;
- time and calls to first useful mutation;
- observation-to-mutation ratio;
- repeated equivalent actions;
- tool selection/argument errors;
- failed commands;
- test/diagnostic convergence;
- context compactions/resets;
- worker utilization;
- integration conflicts;
- verifier false positive/negative rate;
- token/API cost;
- wall-clock latency;
- CPU/RAM/GPU/resource utilization for local systems.

Trajectory metrics help distinguish “model incapable” from “harness led model into waste.”

---

## 19. Public industry systems and convergent practices

Public product descriptions are incomplete views of proprietary systems, so they should not be overinterpreted. Still, several patterns recur.

### 19.1 OpenAI Codex

OpenAI describes Codex as:

- cloud/sandbox-based;
- capable of parallel tasks;
- designed for multiple agents and long-running work;
- integrated with worktrees;
- able to review diffs and run development tools;
- supported by skills and automations.

OpenAI's harness-engineering report describes an internal repository built without human-written code, extensive agent-to-agent review, per-worktree application instances, browser/DevTools access, logs/metrics/traces made agent-legible, and single runs lasting more than six hours.

**Symphony** moves orchestration up to project-management tasks: each open task can map to a continuously running agent workspace. The important conceptual move is treating **deliverables**, not sessions, as the unit of orchestration.

It would be inaccurate to infer undocumented internal role names from these posts. What is public is the use of orchestration, parallelism, isolation, review, and long-running agents.

### 19.2 Anthropic Claude/agent systems

Anthropic's public engineering record spans:

- simple composable agent patterns;
- orchestrator-workers;
- evaluator-optimizer;
- multi-agent research;
- long-running coding harnesses;
- planner-generator-evaluator;
- parallel agent teams;
- dynamic skills/tool loading;
- context engineering;
- filesystem/network sandboxing.

A recurring theme is **harness evolution**: practices that compensated for an older model can become unnecessary or harmful for a stronger one.

### 19.3 OpenHands and open research platforms

OpenHands provides an open substrate for agents using code, terminal, and web in sandboxed environments and supports multiple benchmark/agent implementations. Open platforms are important because they make harness effects inspectable rather than conflating them with a proprietary model.

### 19.4 Convergence

Across these sources, a mature coding-agent system increasingly looks like:

```text
requirements / issue / project board
            ↓
       planning/control
            ↓
     one or more coding agents
            ↓
  isolated execution workspaces
            ↓
 repository + terminal + runtime + web
            ↓
      objective verification
            ↓
 independent/agent review where useful
            ↓
       durable task state
            ↓
 deliverable / merge / deployment
```

This is not one standardized implementation. It is a recurring systems pattern.

---

## 20. What should be simplified—and what should not

“Simple” should mean **low accidental complexity**, not “few capabilities at any cost.”

### 20.1 Strong candidates for simplification

#### Overlapping tools

If several tools perform near-identical searches or reads, merge or dynamically filter them. ToolScope/JTPRO provide direct support for this.

#### Model-driven bookkeeping

Queue maintenance, status polling, memory persistence, timers, retry counters, permission caches, and checkpoint serialization are deterministic runtime concerns unless there is a specific reason for model judgment.

#### Duplicate prompts and policies

A security invariant enforced in code should not also require a paragraph of repeated system instructions on every turn.

#### Unbounded raw output

Large logs/search results should be summarized, filtered, or paged.

#### Redundant meta-agents

If a planner, supervisor, reviewer, and “overwatcher” all inspect the same state and produce interchangeable advice, the architecture has role inflation rather than specialization.

#### Generic retrieval with unmeasured value

Every index, embedding model, graph store, and reranker adds operational cost. Keep retrieval mechanisms that improve representative coding evaluations.

### 20.2 Capabilities that should not be reflexively removed

#### Role specialization

The evidence for planners, navigators/scouts, executors, testers, and evaluators is substantial. Remove a role only after showing that its objective is redundant.

#### Independent evaluation

Objective tests plus fresh-context review are important defenses against premature completion.

#### Durable project state

Long-horizon work cannot depend on one context window.

#### Code-aware repository navigation

Lexical search alone is excellent but not universally sufficient. Symbol and structural navigation are repeatedly supported by repository-level research.

#### Sandboxing and observability

These are what make high autonomy operationally safe and debuggable.

#### Parallelism

Parallel agents are valuable for independent subtasks and can dramatically expand scope. The problem to simplify is coordination mechanics and conflict management, not parallelism itself.

#### Test infrastructure

Tests are imperfect specifications, but they are among the highest-signal environment feedback channels available.

#### Runtime/UI inspection

For web and application development, DOM/runtime/log/metric visibility can be the difference between “code compiles” and “feature works.”

### 20.3 The design rule

For every subsystem, ask:

1. Does it create a distinct capability or separation of concerns?
2. Does it measurably improve success, reliability, cost, or recovery?
3. Can deterministic code perform the same function more reliably?
4. Does it add model-visible choices or context?
5. Does it have a failure mode that compounds over long trajectories?
6. Can it be disabled or replaced without breaking the architecture?

Simplification should be an **evaluation-driven deletion process**, not an aesthetic preference.

---

## 21. A durable design checklist

### Architecture

- [ ] Is there one clear owner of the global objective?
- [ ] Are specialist roles differentiated by objective/context/tools?
- [ ] Does every extra agent earn its inference and coordination cost?
- [ ] Are deterministic workflows used where the task structure is predictable?
- [ ] Can the architecture evolve as models improve?

### Repository interface

- [ ] Fast filename and lexical text search.
- [ ] Targeted bounded reads.
- [ ] Reliable patch/edit primitives.
- [ ] Symbol/definition/reference navigation where useful.
- [ ] Tests and diagnostics accessible.
- [ ] Tool output preserves file/line provenance.
- [ ] Retrieval methods are evaluated by downstream task success.

### Tool surface

- [ ] Tools have non-overlapping semantic purposes.
- [ ] Argument schemas are clear.
- [ ] Each role sees only relevant tools.
- [ ] Large result sets are paginated/filtered.
- [ ] Tool failures are structured and actionable.
- [ ] Runtime bookkeeping is not exposed as unnecessary model actions.

### State and context

- [ ] Requirements live outside ephemeral conversation.
- [ ] Completed work is durable.
- [ ] Failed approaches and blockers survive resets.
- [ ] Verification evidence is bound to current code state.
- [ ] Context is curated, not maximized.
- [ ] Compaction/reset strategy is measurable and replaceable.

### Long horizon

- [ ] Work can continue across context windows.
- [ ] Work can recover from process/model/provider failures.
- [ ] Useful progress, not elapsed time alone, governs continuation.
- [ ] Stall/repetition detectors exist.
- [ ] Checkpoints occur at meaningful milestones.
- [ ] User cancellation and resource quotas remain available.

### Verification

- [ ] Compiler/type/static diagnostics used where applicable.
- [ ] Relevant unit/integration/e2e tests run.
- [ ] Runtime/browser evidence used for user-visible behavior.
- [ ] Requirements checked independently of implementation narrative.
- [ ] Evaluator is calibrated; deterministic checks are preferred when possible.
- [ ] Tests are not blindly treated as perfect specifications.

### Multi-agent

- [ ] Subtasks have explicit inputs/outputs.
- [ ] Runtime owns worker lifecycle and status mechanics.
- [ ] Parallel tasks are actually independent.
- [ ] Shared repository edits are isolated or ownership-controlled.
- [ ] Worker outputs are persisted and compact.
- [ ] Integration is owned by a lead/orchestrator.

### Security

- [ ] Filesystem boundary is technically enforced.
- [ ] Network boundary is technically enforced where needed.
- [ ] Credentials are scoped.
- [ ] Child processes inherit restrictions.
- [ ] Low-risk work is frictionless inside sandbox.
- [ ] Boundary-crossing actions trigger appropriate approval/review.
- [ ] Agent actions and network decisions are auditable.

### Observability

- [ ] Tool calls/results recorded.
- [ ] Model/provider/version recorded.
- [ ] Costs/tokens/wall time recorded.
- [ ] Repetition and stall events recorded.
- [ ] Time/actions to first mutation measured.
- [ ] Verification convergence measured.
- [ ] CPU/RAM/GPU/process telemetry available for operational diagnosis where relevant.
- [ ] Logs allow reproduction of failed trajectories without exposing hidden chain-of-thought.

---

## 22. Open research questions

### 22.1 What is the optimal granularity of roles?

There is evidence for specialization, but no universal answer for whether planner and orchestrator should be separate, whether test designer and evaluator should be separate, or how many worker types are cost-effective for small models.

### 22.2 How should roles be trained jointly?

Most systems prompt general models into roles. Harnessed RL makes it plausible to train role-specific policies inside the actual deployment loop. Credit assignment across cooperating agents remains difficult.

### 22.3 When should an orchestrator delegate?

A useful delegation policy must trade:

- cost;
- parallel speedup;
- context relief;
- worker competence;
- coordination/integration risk.

This could be learned rather than hand-authored.

### 22.4 What is the best long-horizon state representation?

Candidate forms include:

- task graph;
- event log;
- typed project ledger;
- semantic memory;
- source-control history;
- generated architecture docs;
- test/verification ledger.

The challenge is maintaining fidelity without injecting stale or incorrect summaries.

### 22.5 How should progress be measured?

A source mutation is not necessarily progress; a new insight can be progress without a mutation. Robust progress measures likely need multiple signals: task state, code diff, test deltas, evaluator findings, and trajectory novelty.

### 22.6 How should evaluators be made trustworthy?

Independent models can share blind spots. Future systems may combine:

- execution tests;
- static analysis;
- property-based tests;
- multiple evaluators;
- adversarial test generation;
- formal methods;
- human review for high-stakes releases.

### 22.7 What retrieval stack best serves agentic coding?

The frontier is likely hybrid:

- lexical;
- symbol/definition;
- static call/dependency graphs;
- dynamic coverage/traces;
- optional semantic retrieval.

Which components are worth their indexing/context cost remains workload-dependent.

### 22.8 How much autonomy should version control expose?

Worktrees, branches, patches, commits, and PRs each offer different isolation and recovery properties. The right policy differs between a local editor, cloud worker, and enterprise CI agent.

### 22.9 How do we evaluate multi-hour project completion fairly?

Mined issue benchmarks are insufficient. Long-horizon benchmarks need:

- original/non-contaminated tasks;
- implementation-independent verifiers;
- multiple languages/frameworks;
- partial-progress metrics;
- realistic environment failures;
- requirements that span features rather than one patch.

### 22.10 How should agent architectures adapt to model capability?

Managed-agent engineering already shows that assumptions become stale. A future harness may need to automatically ablate its own scaffolding: if a planner no longer improves outcomes, remove it; if a stronger model can carry longer context reliably, reduce resets; if a small model benefits from stronger tool filtering, specialize further.

---

## 23. Annotated bibliography

The references below are grouped by theme. Publication status varies; arXiv-only and very recent 2026 results should be interpreted with appropriate caution.

### Surveys and systems perspectives

1. **Liu et al. (2024), “Large Language Model-Based Agents for Software Engineering: A Survey.”** [arXiv:2409.02977](https://arxiv.org/abs/2409.02977). Systematic survey collecting 106 papers and organizing the field from software-engineering and agent perspectives.
2. **Wang et al. (2024), “Agents in Software Engineering: Survey, Landscape, and Vision.”** [arXiv:2409.09030](https://arxiv.org/abs/2409.09030). Frames software agents around perception, memory, and action.
3. **Jin et al. (2024), “From LLMs to LLM-based Agents for Software Engineering.”** [arXiv:2408.02479](https://arxiv.org/abs/2408.02479). Surveys the transition from standalone LLMs to agents across requirements, generation, design, testing, and maintenance.
4. **Wang et al. (2023), “A Survey on Large Language Model based Autonomous Agents.”** [arXiv:2308.11432](https://arxiv.org/abs/2308.11432). Broad autonomous-agent survey and early unified framework.
5. **Tran et al. (2025), “Multi-Agent Collaboration Mechanisms: A Survey of LLMs.”** [arXiv:2501.06322](https://arxiv.org/abs/2501.06322). Surveys actors, collaboration types, structures, strategies, and coordination protocols.
6. **Jarmak (2026), “Engineering Reliable Coding Agents: Evaluating and Operating the System Around the Model.”** [arXiv:2608.13867](https://arxiv.org/abs/2608.13867). Very recent multivocal system-level review emphasizing harness, state, retrieval, execution, verification, permissions, and observability.
7. **Zhang et al. (2024), “A Survey on the Memory Mechanism of Large Language Model based Agents.”** [arXiv:2404.13501](https://arxiv.org/abs/2404.13501). Organizes memory mechanisms used by LLM agents.
8. **Sumers et al. (2024), “Cognitive Architectures for Language Agents.”** [arXiv:2309.02427](https://arxiv.org/abs/2309.02427). Connects language-agent architectures with cognitive components and decision processes.

### Foundational reasoning, acting, feedback, and tools

9. **Yao et al. (2023), “ReAct: Synergizing Reasoning and Acting in Language Models.”** [arXiv:2210.03629](https://arxiv.org/abs/2210.03629). Foundational interleaving of reasoning traces and environment actions.
10. **Shinn et al. (2023), “Reflexion: Language Agents with Verbal Reinforcement Learning.”** [arXiv:2303.11366](https://arxiv.org/abs/2303.11366). Uses linguistic feedback and episodic reflection to improve later attempts.
11. **Madaan et al. (2023), “Self-Refine: Iterative Refinement with Self-Feedback.”** [arXiv:2303.17651](https://arxiv.org/abs/2303.17651). Demonstrates same-model feedback/refinement loops across multiple domains.
12. **Schick et al. (2023), “Toolformer: Language Models Can Teach Themselves to Use Tools.”** [arXiv:2302.04761](https://arxiv.org/abs/2302.04761). Trains models to decide when, which, and how to call APIs.
13. **Wang et al. (2024), “Executable Code Actions Elicit Better LLM Agents.”** [arXiv:2402.01030](https://arxiv.org/abs/2402.01030). CodeAct studies executable code as a flexible action space.
14. **Wang et al. (2023), “Voyager: An Open-Ended Embodied Agent with Large Language Models.”** [arXiv:2305.16291](https://arxiv.org/abs/2305.16291). Automatic curriculum, executable skill library, environment feedback, and self-verification for long-lived learning.
15. **Packer et al. (2023), “MemGPT: Towards LLMs as Operating Systems.”** [arXiv:2310.08560](https://arxiv.org/abs/2310.08560). Hierarchical/virtual context management for work exceeding model context windows.
16. **Park et al. (2023), “Generative Agents: Interactive Simulacra of Human Behavior.”** [arXiv:2304.03442](https://arxiv.org/abs/2304.03442). Memory, reflection, and planning in long-lived agents; not coding-specific but influential.
17. **Zhong et al. (2023), “MemoryBank: Enhancing Large Language Models with Long-Term Memory.”** [arXiv:2305.10250](https://arxiv.org/abs/2305.10250). Long-term memory mechanisms for interactive agents.

### Core software-engineering agents

18. **Yang et al. (2024), “SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.”** [arXiv:2405.15793](https://arxiv.org/abs/2405.15793). Establishes ACI design as a major determinant of repository-agent performance.
19. **Zhang et al. (2024), “AutoCodeRover: Autonomous Program Improvement.”** [arXiv:2404.05427](https://arxiv.org/abs/2404.05427). AST/program-structure search plus test-driven fault localization and repair.
20. **Xia et al. (2024), “Agentless: Demystifying LLM-based Software Engineering Agents.”** [arXiv:2407.01489](https://arxiv.org/abs/2407.01489). Strong fixed localization-repair-validation baseline; crucial evidence against unnecessary agent complexity.
21. **Arora et al. (2024), “MASAI: Modular Architecture for Software-engineering AI Agents.”** [arXiv:2406.11638](https://arxiv.org/abs/2406.11638). Specialized sub-agents with different objectives and strategies; explicitly motivated partly by avoiding long noisy trajectories.
22. **Huang et al. (2023), “AgentCoder: Multi-Agent-based Code Generation with Iterative Testing and Optimisation.”** [arXiv:2312.13010](https://arxiv.org/abs/2312.13010). Programmer, test designer, and test executor specialization.
23. **Ruan et al. (2024/ICSE 2025), “SpecRover: Code Intent Extraction via LLMs.”** [arXiv:2408.02232](https://arxiv.org/abs/2408.02232). Iterative specification inference plus reviewer agent for patch vetting/confidence.
24. **Chen et al. (2024), “CodeR: Issue Resolving with Multi-Agent and Task Graphs.”** [arXiv:2406.01304](https://arxiv.org/abs/2406.01304). Multi-agent issue resolution organized by predefined task graphs.
25. **Wang et al. (2024), “OpenHands: An Open Platform for AI Software Developers as Generalist Agents.”** [arXiv:2407.16741](https://arxiv.org/abs/2407.16741). Open platform combining code, terminal, web, sandboxing, multiple agents, and benchmarks.
26. **Phan et al. (2024), “HyperAgent: Generalist Software Engineering Agents to Solve Coding Tasks at Scale.”** [arXiv:2409.16299](https://arxiv.org/abs/2409.16299). Planner, Navigator, Code Editor, Executor across multiple software tasks.
27. **Antoniades et al. (2024), “SWE-Search: Enhancing Software Agents with Monte Carlo Tree Search and Iterative Refinement.”** [arXiv:2410.20285](https://arxiv.org/abs/2410.20285). SWE-Agent + Value Agent + Discriminator Agent with MCTS.
28. **Guo et al. (2025), “RepoAudit: An Autonomous LLM-Agent for Repository-Level Code Auditing.”** [arXiv:2501.18160](https://arxiv.org/abs/2501.18160). On-demand repository exploration, memory, and validator for data-flow/path claims.
29. **Qian et al. (2024), “ChatDev: Communicative Agents for Software Development.”** [ACL 2024](https://aclanthology.org/2024.acl-long.810/). Specialized design/coding/testing agents and structured communication.
30. **Hong et al. (2023), “MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework.”** [arXiv:2308.00352](https://arxiv.org/abs/2308.00352). SOPs, role specialization, and structured intermediate artifacts.
31. **Islam et al. (2024), “MapCoder: Multi-Agent Code Generation for Competitive Problem Solving.”** [arXiv:2405.11403](https://arxiv.org/abs/2405.11403). Agents for example recall, planning, generation, and debugging.
32. **Islam et al. (2025), “CODESIM: Multi-Agent Code Generation and Problem Solving through Simulation-Driven Planning and Debugging.”** [arXiv:2502.05664](https://arxiv.org/abs/2502.05664). Adds plan verification/simulation and debugging roles.
33. **Du et al. (2024/ACL Findings 2025), “Multi-Agent Software Development through Cross-Team Collaboration.”** [arXiv:2406.08979](https://arxiv.org/abs/2406.08979). Multiple teams explore different decision paths and share insights.
34. **Chen et al. (2023), “AgentVerse: Facilitating Multi-Agent Collaboration and Exploring Emergent Behaviors.”** [arXiv:2308.10848](https://arxiv.org/abs/2308.10848). General multi-agent collaboration framework and emergent group behavior.
35. **Wu et al. (2023), “AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation.”** [arXiv:2308.08155](https://arxiv.org/abs/2308.08155). Flexible conversable-agent framework combining LLMs, tools, and humans.

### Repository retrieval and code context

36. **Zhang et al. (2023), “RepoCoder: Repository-Level Code Completion Through Iterative Retrieval and Generation.”** [arXiv:2303.12570](https://arxiv.org/abs/2303.12570). Iterative retrieval-generation using repository context.
37. **Liu et al. (2023), “RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems.”** [arXiv:2306.03091](https://arxiv.org/abs/2306.03091). Separates retrieval, completion, and full pipeline evaluation.
38. **Ding et al. (2023), “CrossCodeEval: A Diverse and Multilingual Benchmark for Cross-File Code Completion.”** [arXiv:2310.11248](https://arxiv.org/abs/2310.11248). Demonstrates need for cross-file context across multiple languages.
39. **Liu et al. (2024), “GraphCoder: Enhancing Repository-Level Code Completion via Code Context Graph-based Retrieval and Language Model.”** [arXiv:2406.07003](https://arxiv.org/abs/2406.07003). Uses control-flow/data/control-dependence context graph.
40. **Zhang et al. (2025), “One Tool Is Enough: Reinforcement Learning for Repository-Level LLM Agents.”** [arXiv:2512.20957](https://arxiv.org/abs/2512.20957). RepoNavigator uses one execution-aware definition-jump tool and RL, highlighting the value of structurally grounded low-complexity interfaces.
41. **Jiang et al. (2026), “AlignCoder: Aligning Retrieval with Target Intent for Repository-Level Code Completion.”** [arXiv:2601.19697](https://arxiv.org/abs/2601.19697). Query enhancement and learned retrieval for repository completion.
42. **Pei et al. (2023), “RepoFusion: Training Code Models to Understand Your Repository.”** [arXiv:2306.10998](https://arxiv.org/abs/2306.10998). Repository context fusion for code generation.
43. **Shrivastava et al. (2023), “Repoformer: Selective Retrieval for Repository-Level Code Completion.”** [arXiv:2403.10059](https://arxiv.org/abs/2403.10059). Selective retrieval asks when retrieval is useful rather than always injecting external context.

### Tool use, context, and harness engineering

44. **Liu et al. (ACL 2026), “ToolScope: Enhancing LLM Agent Tool Use through Tool Merging and Context-Aware Filtering.”** [ACL Anthology](https://aclanthology.org/2026.acl-long.1573/). Redundancy reduction and query-conditioned tool filtering; reports 8.38–38.6% tool-selection accuracy gains in studied settings.
45. **Ghoshal et al. (Findings ACL 2026), “JTPRO: A Joint Tool–Prompt Reflective Optimization Framework for Language Agents.”** [ACL Anthology](https://aclanthology.org/2026.findings-acl.2017/). Co-optimizes global instructions and tool schemas from traces; reports 5–20% relative overall-success improvements.
46. **Li et al. (ACL 2026), “Rethinking the Role of Entropy in Optimizing Tool-Use Behaviors for Large Language Model Agents.”** [ACL Anthology](https://aclanthology.org/2026.acl-long.1288/). Studies excessive low-quality tool calls in long trajectories.
47. **Wang et al. (ACL 2026), “MCP-Flow: Facilitating LLM Agents to Master Real-World, Diverse and Scaling MCP Tools.”** [ACL Anthology](https://aclanthology.org/2026.acl-long.231/). Dataset/training pipeline spanning 1,166 servers and 11,536 tools.
48. **Shi et al. (2023), “Large Language Models Can Be Easily Distracted by Irrelevant Context.”** [arXiv:2302.00093](https://arxiv.org/abs/2302.00093). Demonstrates degradation from irrelevant input context.
49. **Vasileva (2026), “Large Language Models Can Follow Instructions, But Not Many at Once.”** [arXiv:2608.12426](https://arxiv.org/abs/2608.12426). Very recent preprint on compositional constraint saturation; useful supporting evidence, not yet a mature universal result.
50. **Lin et al. (2026), “Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses.”** [arXiv:2604.25850](https://arxiv.org/abs/2604.25850). Evolves harness components from observable trajectory evidence; ablations emphasize tools/middleware/memory over prompt-only changes.
51. **Majgaonkar et al. (2025), “Understanding Code Agent Behaviour: An Empirical Study of Success and Failure Trajectories.”** [arXiv:2511.00197](https://arxiv.org/abs/2511.00197). Finds failed trajectories longer/more variable and studies localization versus modification success.
52. **Anthropic (2025), “Writing effective tools for AI agents—with agents.”** [Engineering report](https://www.anthropic.com/engineering/writing-tools-for-agents). Practical guidance on tool semantics, schemas, output context, and evaluation.
53. **Anthropic (2025), “Effective context engineering for AI agents.”** [Engineering report](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). Treats context as finite resource and describes just-in-time retrieval, compaction, notes, and multi-agent context separation.
54. **Anthropic (2025), “Introducing advanced tool use.”** [Engineering index](https://www.anthropic.com/engineering). Dynamic/on-demand tool loading for large inventories.
55. **Anthropic (2025), “Code execution with MCP: Building more efficient agents.”** [Engineering index](https://www.anthropic.com/engineering). Explores code-mediated tool access to reduce context/tool-call overhead.
56. **Anthropic (2025), “Equipping agents for the real world with Agent Skills.”** [Engineering index](https://www.anthropic.com/engineering). Progressive disclosure of reusable instructions/scripts/resources.

### Long-running and multi-agent industry engineering

57. **Anthropic (2024), “Building effective agents.”** [Engineering report](https://www.anthropic.com/engineering/building-effective-agents). Distinguishes workflows from agents and documents common patterns including orchestrator-workers and evaluator-optimizer.
58. **Anthropic (2025), “How we built our multi-agent research system.”** [Engineering report](https://www.anthropic.com/engineering/multi-agent-research-system). Production orchestrator-worker architecture with parallel subagents; discusses coordination/evaluation/reliability.
59. **Anthropic (2025), “Effective harnesses for long-running agents.”** [Engineering report](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). Structured artifacts and session handoffs for hours/days of work across context windows.
60. **Anthropic (2026), “Harness design for long-running application development.”** [Engineering report](https://www.anthropic.com/engineering/harness-design-long-running-apps). Planner-generator-evaluator architecture for multi-hour full-stack application development.
61. **Anthropic (2026), “Building a C compiler with a team of parallel Claudes.”** [Engineering report](https://www.anthropic.com/engineering/building-c-compiler). 16-agent, nearly 2,000-session experiment; emphasizes testing, decomposition, and parallel coordination.
62. **Anthropic (2026), “Scaling Managed Agents: Decoupling the brain from the hands.”** [Engineering report](https://www.anthropic.com/engineering/managed-agents). Warns that harness assumptions go stale as model capabilities change.
63. **OpenAI (2025), “Introducing Codex.”** [Product/engineering report](https://openai.com/index/introducing-codex/). Cloud coding agent running tasks in isolated sandboxes and in parallel.
64. **OpenAI (2026), “Introducing the Codex app.”** [Product/engineering report](https://openai.com/index/introducing-the-codex-app/). Multi-agent command center, worktree isolation, long-running tasks, skills, automations.
65. **OpenAI (2026), “Harness engineering: leveraging Codex in an agent-first world.”** [Engineering report](https://openai.com/index/harness-engineering/). Agent-friendly repo, agent-to-agent review, browser/runtime/observability interfaces, long individual runs.
66. **OpenAI (2026), “An open-source spec for Codex orchestration: Symphony.”** [Engineering report](https://openai.com/index/open-source-codex-orchestration-symphony/). Project-board-driven continuous agent orchestration.
67. **OpenAI (2026), “Unlocking the Codex harness: how we built the App Server.”** [Engineering report](https://openai.com/index/unlocking-the-codex-harness/). Stable harness server/protocol used across IDEs and multi-agent clients.
68. **OpenAI (2026), “How agents are transforming work.”** [Industry report](https://openai.com/index/how-agents-are-transforming-work/). Describes delegation over minutes/hours and increasing multi-step work.

### Security and containment

69. **Anthropic (2025), “Beyond permission prompts: making Claude Code more secure and autonomous.”** [Engineering report](https://www.anthropic.com/engineering/claude-code-sandboxing). Filesystem/network sandboxing and reduced approval friction.
70. **Anthropic (2026), “How we contain Claude across products.”** [Engineering report](https://www.anthropic.com/engineering/how-we-contain-claude). Blast-radius containment and deterministic boundaries for increasingly capable agents.
71. **OpenAI (2026), “Running Codex safely at OpenAI.”** [Engineering report](https://openai.com/index/running-codex-safely/). Managed configuration, execution constraints, network policies, and agent-native telemetry.
72. **Zhang et al. (2025), “LLM Agents Should Employ Security Principles.”** [arXiv:2505.24019](https://arxiv.org/abs/2505.24019). Applies defense-in-depth, least privilege, complete mediation, and other established security principles to agents.
73. **Greshake et al. (2023), “Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection.”** [arXiv:2302.12173](https://arxiv.org/abs/2302.12173). Foundational indirect prompt-injection risk relevant to agents reading untrusted repository/web content.

### Training and reinforcement learning

74. **Pan et al. (ICML 2025), “Training Software Engineering Agents and Verifiers with SWE-Gym.”** [arXiv:2412.21139](https://arxiv.org/abs/2412.21139). 2,438 executable tasks; agent and verifier training.
75. **Golubev et al. (2025), “Training Long-Context, Multi-Turn Software Engineering Agents with Reinforcement Learning.”** [arXiv:2508.03501](https://arxiv.org/abs/2508.03501). RL directly over stateful multi-turn SWE interactions.
76. **Luo et al. (2025), “Agent Lightning: Train ANY AI Agents with Reinforcement Learning.”** [arXiv:2508.03680](https://arxiv.org/abs/2508.03680). Decouples agent execution from RL training.
77. **He et al. (2026), “Agent Lightning v1.0: Towards Harnessed Agentic RL.”** [arXiv:2608.17528](https://arxiv.org/abs/2608.17528). Very recent harness-in-the-loop RL framework; reports a substantial Qwen3.5-9B SWE-bench Verified gain under its published setup.
78. **Le et al. (2022), “CodeRL: Mastering Code Generation through Pretrained Models and Deep Reinforcement Learning.”** [arXiv:2207.01780](https://arxiv.org/abs/2207.01780). Earlier unit-test-feedback/RL line of work relevant to execution-grounded training.

### Benchmarks and evaluation quality

79. **Jimenez et al. (ICLR 2024), “SWE-bench: Can Language Models Resolve Real-World GitHub Issues?”** [arXiv:2310.06770](https://arxiv.org/abs/2310.06770). 2,294 real repository issues; seminal repository-agent benchmark.
80. **OpenAI et al. (2024), “Introducing SWE-bench Verified.”** [OpenAI](https://openai.com/index/introducing-swe-bench-verified/). Human-validates a 500-task subset and documents annotation methodology.
81. **OpenAI (2026), “Why SWE-bench Verified no longer measures frontier coding capabilities.”** [OpenAI](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/). Documents contamination and residual evaluation flaws.
82. **OpenAI (2026), “Separating signal from noise in coding evaluations.”** [OpenAI](https://openai.com/index/separating-signal-from-noise-coding-evaluations/). Audits SWE-Bench Pro and estimates roughly 30% broken tasks, illustrating evaluator fragility.
83. **Miserendino et al. (2025), “SWE-Lancer.”** [arXiv:2502.12115](https://arxiv.org/abs/2502.12115). More than 1,400 real freelance tasks tied to roughly $1M in payouts.
84. **Rashid et al. (2025), “SWE-PolyBench.”** [arXiv:2504.08703](https://arxiv.org/abs/2504.08703). 2,110 multi-language repository tasks covering bugs, features, and refactors.
85. **Badertdinov et al. (2025), “SWE-rebench.”** [arXiv:2505.20411](https://arxiv.org/abs/2505.20411). Automated fresh-task collection for training and contamination-resistant evaluation.
86. **Deng et al. (2025), “SWE-Bench Pro.”** [arXiv:2509.16941](https://arxiv.org/abs/2509.16941). Long-horizon 1,865-task benchmark across 41 repositories; should be read alongside later audit concerns.
87. **Thai et al. (2025), “SWE-EVO.”** [arXiv:2512.18470](https://arxiv.org/abs/2512.18470). Long-horizon software-evolution tasks spanning many files/tests.
88. **Huang et al. (2026), “DeepSWE: Measuring Frontier Coding Agents on Original, Long-Horizon Engineering Tasks.”** [arXiv:2607.07946](https://arxiv.org/abs/2607.07946). Original non-upstreamed tasks and hand-written functional verifiers.
89. **Starace et al. (2025), “PaperBench: Evaluating AI's Ability to Replicate AI Research.”** [arXiv:2504.01848](https://arxiv.org/abs/2504.01848). Twenty research replications and 8,316 gradable subtasks.
90. **Chan et al. (2024), “MLE-bench: Evaluating Machine Learning Agents on Machine Learning Engineering.”** [arXiv:2410.07095](https://arxiv.org/abs/2410.07095). 75 Kaggle competition environments and resource-scaling analysis.
91. **Jain et al. (2024), “LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code.”** [arXiv:2403.07974](https://arxiv.org/abs/2403.07974). Fresh code problems; less repository-agentic than SWE-bench but important contamination methodology.
92. **Tian et al. (2024), “DebugBench.”** [arXiv:2401.04621](https://arxiv.org/abs/2401.04621). Debugging-focused benchmark useful for separating repair ability from general generation.
93. **OpenAI Preparedness team (2025), PaperBench judge methodology.** See [PaperBench](https://arxiv.org/abs/2504.01848). Important precedent for evaluating the evaluator itself.

### Additional multi-agent and planning foundations

94. **Li et al. (2023), “CAMEL: Communicative Agents for Mind Exploration of Large Scale Language Model Society.”** [arXiv:2303.17760](https://arxiv.org/abs/2303.17760). Role-playing multi-agent cooperation.
95. **Wang et al. (2024), “Mixture-of-Agents Enhances Large Language Model Capabilities.”** [arXiv:2406.04692](https://arxiv.org/abs/2406.04692). Layered aggregation of multiple model outputs; general evidence for multi-model collaboration.
96. **Li et al. (2024), “More Agents Is All You Need.”** [arXiv:2402.05120](https://arxiv.org/abs/2402.05120). Scaling via multiple sampled agents/voting; not evidence that arbitrary coding-agent teams always help.
97. **Zhang et al. (2024), “Scaling Large-Language-Model-based Multi-Agent Collaboration.”** [arXiv:2406.07155](https://arxiv.org/abs/2406.07155). Studies multi-agent topology and collaboration scaling.
98. **Yao et al. (2023), “Tree of Thoughts: Deliberate Problem Solving with Large Language Models.”** [arXiv:2305.10601](https://arxiv.org/abs/2305.10601). Search over reasoning branches, conceptually relevant to trajectory search.
99. **Zhou et al. (2023), “Language Agent Tree Search Unifies Reasoning, Acting, and Planning.”** [arXiv:2310.04406](https://arxiv.org/abs/2310.04406). Tree search in interactive language-agent trajectories.
100. **Prasad et al. (2023), “ADaPT: As-Needed Decomposition and Planning with Language Models.”** [arXiv:2311.05772](https://arxiv.org/abs/2311.05772). Adaptive decomposition rather than always planning to maximum depth.

---

## Closing perspective

The most useful mental model for agentic coding is not “an LLM that can call tools.” It is a **software-production system whose stochastic reasoning component is embedded inside deterministic engineering infrastructure**.

The field's strongest results repeatedly come from making the entire system better:

- giving models interfaces they can reliably operate;
- retrieving the right repository evidence instead of the most evidence;
- separating planning, investigation, implementation, and evaluation when those objectives conflict;
- preserving durable project state outside ephemeral context;
- executing code in real, reproducible environments;
- using tests and diagnostics as feedback rather than ceremony;
- sandboxing agents so autonomy can increase safely;
- measuring trajectories, not merely final answers;
- training against the actual harness when possible;
- and deleting architectural complexity that fails to create measurable capability.

The correct design target is therefore neither maximalism nor minimalism.

It is **earned complexity**: every role, tool, memory layer, retrieval mechanism, reviewer, and orchestration primitive should exist because it contributes a distinct, measurable function to reliable autonomous engineering. Everything else is overhead waiting to become a failure mode.
