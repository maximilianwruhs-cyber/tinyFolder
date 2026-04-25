/**
 * GZMO Chaos Engine — Thought Cabinet
 *
 * Direct port of thoughts.rs.
 * Disco Elysium-inspired internalization system:
 *   1. Lore/skill outputs are stochastically ABSORBED (18% chance)
 *   2. Thoughts INCUBATE for N ticks (category-dependent)
 *   3. Mature thoughts CRYSTALLIZE into permanent physics mutations
 *
 * Crystallizations are IRREVERSIBLE — they permanently reshape the
 * Lorenz attractor's topology and the engine's physical constants.
 */

import type {
  Mutations, MutationEffect, CrystallizationEvent,
} from "./types";
import { defaultMutations, clamp } from "./types";

const MAX_SLOTS = 5;
const ABSORPTION_THRESHOLD = 0.18;

const INCUBATION_MAP: Record<string, number> = {
  sound: 8,
  dice_crit: 10,
  joke: 15,
  poem: 25,
  quote: 30,
  card: 35,
  story: 40,
  fact: 45,
  persona: 60,
  interaction: 20,
  tool_use: 15,
  heartbeat: 30,
  dream: 50,
  wiki_edit: 40,
  // Daemon-specific categories
  task_completed: 25,
  task_failed: 15,
};

const DEFAULT_INCUBATION = 20;

const DRAIN_PER_THOUGHT = 0.15;
const NOISE_PER_THOUGHT = 0.5;

interface IncubatingThought {
  category: string;
  text: string;
  tickAbsorbed: number;
  ticksRequired: number;
  ticksRemaining: number;
}

export class ThoughtCabinet {
  private slots: (IncubatingThought | null)[] = new Array(MAX_SLOTS).fill(null);
  mutations: Mutations = defaultMutations();

  tryAbsorb(category: string, text: string, tick: number, chaosRoll: number): boolean {
    if (chaosRoll > ABSORPTION_THRESHOLD) return false;

    const freeIdx = this.slots.findIndex(s => s === null);
    if (freeIdx === -1) return false;

    const ticksRequired = INCUBATION_MAP[category] ?? DEFAULT_INCUBATION;

    this.slots[freeIdx] = {
      category,
      text,
      tickAbsorbed: tick,
      ticksRequired,
      ticksRemaining: ticksRequired,
    };

    return true;
  }

  tick(): CrystallizationEvent[] {
    const crystallizations: CrystallizationEvent[] = [];

    for (let i = 0; i < this.slots.length; i++) {
      const thought = this.slots[i];
      if (!thought) continue;

      thought.ticksRemaining--;

      if (thought.ticksRemaining <= 0) {
        const mutation = this.computeMutation(thought.category);
        this.applyMutation(mutation);

        crystallizations.push({
          category: thought.category,
          text: thought.text,
          tickAbsorbed: thought.tickAbsorbed,
          tickCrystallized: 0,
          mutation,
        });

        this.slots[i] = null;
      }
    }

    return crystallizations;
  }

  occupiedSlots(): number {
    return this.slots.filter(s => s !== null).length;
  }

  activeDrainMultiplier(): number {
    return 1.0 + this.occupiedSlots() * DRAIN_PER_THOUGHT;
  }

  activeLorenzNoise(): number {
    return this.occupiedSlots() * NOISE_PER_THOUGHT;
  }

  private computeMutation(category: string): MutationEffect {
    switch (category) {
      case "joke":
        return { target: "gravity", delta: -0.1, description: "Humor lightens the engine's gravitational pull" };
      case "quote":
        return { target: "lorenz_rho", delta: 0.3, description: "Wisdom reshapes the attractor's orbital topology" };
      case "fact":
      case "wiki_edit":
        return { target: "friction", delta: -0.02, description: "Truth reduces systemic resistance" };
      case "poem":
        return { target: "gravity+rho", delta: -0.05, description: "Verse loosens the engine's grip on determinism" };
      case "story":
        return { target: "lorenz_rho", delta: 0.5, description: "Narrative restructures phase space geometry" };
      case "card":
        return { target: "friction", delta: -0.03, description: "A forged card greases the gears of chaos" };
      case "dice_crit":
        return { target: "tension_bias", delta: -2.0, description: "Fortune's memory lowers baseline anxiety" };
      case "sound":
        return { target: "friction", delta: -0.01, description: "Auditory resonance smooths turbulent transitions" };
      case "persona":
        return { target: "gravity+rho", delta: 0.2, description: "Identity crystallization adds existential weight" };
      case "interaction":
        return { target: "friction", delta: -0.01, description: "Conversation flow smooths resistance" };
      case "tool_use":
        return { target: "gravity", delta: -0.05, description: "Successful tool use reduces gravitational burden" };
      case "heartbeat":
        return { target: "tension_bias", delta: -1.0, description: "Routine heartbeat calms systemic anxiety" };
      case "dream":
        return { target: "lorenz_rho", delta: 0.8, description: "Dream consolidation profoundly reshapes attractor topology" };
      // Daemon-specific
      case "task_completed":
        return { target: "tension_bias", delta: -1.5, description: "Completed work releases accumulated pressure" };
      case "task_failed":
        return { target: "gravity", delta: 0.1, description: "Failure adds gravitas to future attempts" };
      default:
        return { target: "friction", delta: -0.005, description: "Unknown experience marginally reduces friction" };
    }
  }

  private applyMutation(mutation: MutationEffect): void {
    this.mutations.totalCrystallized++;

    switch (mutation.target) {
      case "gravity":
        this.mutations.gravityMod = clamp(this.mutations.gravityMod + mutation.delta, -5.0, 5.0);
        break;
      case "friction":
        this.mutations.frictionMod = clamp(this.mutations.frictionMod + mutation.delta, -0.5, 0.5);
        break;
      case "lorenz_rho":
        this.mutations.lorenzRhoMod = clamp(this.mutations.lorenzRhoMod + mutation.delta, -10.0, 10.0);
        break;
      case "tension_bias":
        this.mutations.tensionBias = clamp(this.mutations.tensionBias + mutation.delta, -30.0, 30.0);
        break;
      case "gravity+rho":
        this.mutations.gravityMod = clamp(this.mutations.gravityMod + mutation.delta, -5.0, 5.0);
        const rhoEffect = mutation.delta > 0 ? mutation.delta * 4.0 : mutation.delta * 2.0;
        this.mutations.lorenzRhoMod = clamp(
          this.mutations.lorenzRhoMod + rhoEffect,
          -10.0, 10.0,
        );
        break;
    }
  }
}
