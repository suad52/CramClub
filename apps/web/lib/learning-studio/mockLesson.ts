import type { Chunk, Lesson } from "./schema";

/** Sample notes for the demo lesson, so its citations and the AI teacher have something to ground on. */
export const SAMPLE_NOTES: Chunk[] = [
  {
    page: 1,
    text: "Cellular respiration is how cells release energy stored in glucose and capture it as ATP, the cell's energy currency. Aerobic respiration uses oxygen and produces carbon dioxide and water. Overall: glucose + oxygen -> carbon dioxide + water + ATP. It happens in three main stages: glycolysis, the Krebs cycle and the electron transport chain.",
  },
  {
    page: 2,
    text: "Glycolysis takes place in the cytoplasm and does not need oxygen. One glucose (6 carbons) is split into two pyruvate (3 carbons each). The cell invests 2 ATP at the start and makes 4 ATP later, a net gain of 2 ATP, plus 2 NADH.",
  },
  {
    page: 3,
    text: "In the mitochondrial matrix each pyruvate becomes acetyl-CoA, which enters the Krebs cycle. Each turn of the cycle releases CO2 and produces NADH, FADH2 and a little ATP. The cycle turns twice per glucose. Its main job is to load electron carriers (NADH and FADH2).",
  },
  {
    page: 4,
    text: "The electron transport chain sits in the inner mitochondrial membrane. NADH and FADH2 hand over electrons, which pass along protein complexes. Their energy pumps protons (H+) into the intermembrane space, building a gradient. Protons flow back through ATP synthase, which makes most of the cell's ATP (about 26-28 per glucose). Oxygen is the final electron acceptor and forms water.",
  },
];

/** The brief's first demo: a short cellular-respiration lesson (used before anything is uploaded). */
export const SAMPLE_LESSON: Lesson = {
  title: "Cellular respiration",
  subject: "Biology",
  description:
    "How cells turn glucose into ATP, stage by stage: glycolysis, the Krebs cycle and the electron transport chain.",
  estimatedMinutes: 5,
  difficulty: "high-school",
  learningObjectives: [
    "Explain why cells need cellular respiration",
    "Describe what happens in glycolysis, the Krebs cycle and the electron transport chain",
    "Identify where most ATP is made",
  ],
  scenes: [
    {
      id: "intro",
      title: "Why cells need energy",
      narration:
        "Every cell needs a steady supply of energy to stay alive. Cellular respiration is how cells release the energy stored in glucose and capture it as ATP, the cell's energy currency. With oxygen, glucose is broken down into carbon dioxide and water. The process runs in three main stages, which we'll take one at a time.",
      visual: {
        type: "concept",
        templateId: "hub",
        title: "Cellular respiration",
        labels: ["Glucose in", "Oxygen in", "ATP out", "CO₂ + water out"],
      },
      sourceReferences: [{ page: 1, excerpt: "glucose + oxygen -> carbon dioxide + water + ATP" }],
    },
    {
      id: "glycolysis",
      title: "Glycolysis",
      narration:
        "Stage one is glycolysis, and it happens in the cytoplasm without needing oxygen. One glucose molecule, with six carbons, is split into two molecules of pyruvate. The cell has to invest two ATP to get started, but it makes four ATP later on. That leaves a net gain of two ATP, plus two NADH to use later.",
      visual: {
        type: "process",
        templateId: "flow",
        title: "Glycolysis (cytoplasm)",
        steps: [
          { label: "Glucose", description: "6 carbons" },
          { label: "Invest 2 ATP", description: "Energy to get started" },
          { label: "Split in two", description: "Two 3-carbon pieces" },
          { label: "2 pyruvate", description: "+4 ATP made, +2 NADH" },
        ],
      },
      sourceReferences: [{ page: 2, excerpt: "net gain of 2 ATP, plus 2 NADH" }],
    },
    {
      id: "krebs",
      title: "The Krebs cycle",
      narration:
        "Next, pyruvate moves into the mitochondrion and becomes acetyl-CoA, which feeds the Krebs cycle. Each turn of the cycle releases carbon dioxide and fills the electron carriers NADH and FADH2. It makes only a little ATP directly. The cycle turns twice for every glucose, and its real job is loading those carriers.",
      visual: {
        type: "process",
        templateId: "cycle",
        title: "Krebs cycle (matrix)",
        steps: [
          { label: "Acetyl-CoA enters" },
          { label: "CO₂ released" },
          { label: "NADH + FADH₂ loaded" },
          { label: "A little ATP" },
        ],
      },
      sourceReferences: [{ page: 3, excerpt: "Its main job is to load electron carriers" }],
    },
    {
      id: "etc",
      title: "The electron transport chain",
      narration:
        "Finally, the electron transport chain in the inner mitochondrial membrane. NADH and FADH2 hand over their electrons, which pass along a chain of proteins. Their energy pumps protons across the membrane, building up a gradient. As the protons flow back through ATP synthase, most of the cell's ATP is made. Oxygen waits at the end to accept the electrons, forming water.",
      visual: {
        type: "diagram",
        templateId: "labeled",
        title: "Inner mitochondrial membrane",
        labels: [
          "NADH & FADH₂ give electrons",
          "Protons pumped across",
          "Proton gradient",
          "ATP synthase makes ATP",
          "O₂ + electrons → water",
        ],
      },
      sourceReferences: [{ page: 4, excerpt: "ATP synthase, which makes most of the cell's ATP" }],
    },
    {
      id: "check",
      title: "Check your understanding",
      narration:
        "Let's check that it stuck. Think about which stage produces the most ATP, and why. Pick your answer below.",
      visual: {
        type: "comparison",
        templateId: "two-column",
        title: "ATP by stage",
        columns: ["Stage", "ATP per glucose"],
        labels: [
          "Glycolysis | 2 (net)",
          "Krebs cycle | 2",
          "Electron transport chain | about 26–28",
        ],
      },
      interaction: {
        type: "multiple-choice",
        question: "Which stage makes most of the cell's ATP?",
        options: [
          "Glycolysis",
          "The Krebs cycle",
          "The electron transport chain",
          "All stages make the same amount",
        ],
        correctIndex: 2,
        explanation:
          "The electron transport chain uses the proton gradient to drive ATP synthase, making about 26–28 ATP per glucose (page 4).",
      },
      sourceReferences: [{ page: 4 }],
    },
    {
      id: "summary",
      title: "Summary",
      narration:
        "To recap: glycolysis splits glucose into pyruvate for a small ATP gain. The Krebs cycle loads the electron carriers. The electron transport chain uses them to make most of the ATP, with oxygen as the final electron acceptor. Each stage hands its products to the next.",
      visual: {
        type: "process",
        templateId: "timeline",
        title: "From glucose to ATP",
        steps: [
          { label: "Glycolysis", description: "Cytoplasm · 2 ATP" },
          { label: "Krebs cycle", description: "Matrix · loads carriers" },
          { label: "Electron transport", description: "Inner membrane · ~26–28 ATP" },
        ],
      },
      sourceReferences: [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }],
    },
  ],
};
