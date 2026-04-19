// ============================================================
// PRIMITIVE TYPES
// ============================================================

type EntityId = number;
type LogMessage = string | null;
type EventSource = EntityId | "player" | "system";
type EventTarget = EntityId | "player_A" | "player_B" | "all" | "none";
type PlayerId = "A" | "B";

interface Coords {
  x: number;
  y: number;
}

// ============================================================
// EVENT TRIGGERS
// ============================================================

export const EventTime = {
  deal_damage:                  "on_deal_damage",
  take_damage:                  "on_take_damage",
  played:                       "on_played",
  killed:                       "on_killed",
  moved:                        "on_moved",
  owner_turn_start:             "on_owner_turn_start",
  opponent_turn_start:          "on_opponent_turn_start",
  owner_turn_end:               "on_owner_turn_end",
  opponent_turn_end:            "on_opponent_turn_end",
  cast:                         "on_cast",
  player_cast:                  "on_player_cast",
  player_cast_creature:         "on_player_cast_creature",
  player_cast_construction:     "on_player_cast_construction",
  player_cast_casting:          "on_player_cast_casting",
  opponent_cast:                "on_opponent_cast",
  opponent_cast_creature:       "on_opponent_cast_creature",
  opponent_cast_construction:   "on_opponent_cast_construction",
  opponent_cast_casting:        "on_opponent_cast_casting",
  take_castle_control:          "on_take_castle_control",
  lose_castle_control:          "on_lose_castle_control",
  change_castle_control:        "on_change_castle_control",
} as const;

export type EventTime = typeof EventTime[keyof typeof EventTime];

// ============================================================
// EVENTS
// ============================================================

interface BaseEvent {
  trigger:  EventTime;
  source:   EventSource;
  target:   EventTarget;
  log?:     LogMessage;
  // Mutation guard: set to true by the engine after the MODIFY
  // phase so no ability can mutate a resolved event.
  _resolved?: boolean;
}

// Carries a mutable damage/heal amount.
interface AmountEvent extends BaseEvent {
  amount: number;
}

// Carries positional information for movement.
interface MoveEvent extends BaseEvent {
  from: Coords;
  to:   Coords;
}

// Carries the caster's player identity.
interface CastEvent extends BaseEvent {
  caster: PlayerId;
}

// Castle-control events carry who took over.
interface CastleEvent extends BaseEvent {
  new_controller: PlayerId;
  old_controller: PlayerId | null;
}

// Union — GameEvent is whatever any ability or the engine can emit.
export type GameEvent =
  | AmountEvent
  | MoveEvent
  | CastEvent
  | CastleEvent
  | BaseEvent;

// ============================================================
// ABILITIES
// ============================================================

/**
 * modify: called BEFORE the event resolves. The ability may
 *   mutate `event` directly (e.g. reduce `amount`). Return
 *   value is ignored — side effects only.
 *
 * react: called AFTER the event resolves. Return new events
 *   to enqueue for processing (chain reactions).
 *
 * Only one of the two needs to be provided.
 */
interface Ability {
  trigger: EventTime;
  // Friendly name for debugging / log display.
  name: string;

  /**
   * MODIFY phase — mutate the event before it resolves.
   * Use this for shields, damage reduction, redirection, etc.
   */
  modify?: (
    state:   GameState,
    event:   GameEvent,
    selfId:  EntityId
  ) => void;

  /**
   * REACT phase — fire after the event resolves.
   * Return follow-up events to enqueue.
   */
  react?: (
    state:   GameState,
    event:   GameEvent,
    selfId:  EntityId
  ) => GameEvent[];
}

// ============================================================
// TEMPLATES & ENTITIES
// ============================================================

interface Playable {
  cost: number;
}

interface CreatureTemplate extends Playable {
  name:      string;
  attack:    number;
  defense:   number;
  hp:        number;
  energy:    number;
  abilities: Ability[];
}

interface ConstructionTemplate extends Playable {
  name:      string;
  defense:   number;
  hp:        number;
  abilities: Ability[];
}

class Creature {
  name:             string;
  attack:           number;
  defense:          number;
  base_hp:          number;
  remaining_hp:     number;
  base_energy:      number;
  energy_remaining: number;
  abilities:        Ability[];

  constructor(
    name:      string,
    attack:    number,
    defense:   number,
    hp:        number,
    energy:    number,
    abilities: Ability[]
  ) {
    this.name             = name;
    this.attack           = attack;
    this.defense          = defense;
    this.base_hp          = hp;
    this.remaining_hp     = hp;
    this.base_energy      = energy;
    this.energy_remaining = energy;
    this.abilities        = abilities;
  }

  static from_template(t: CreatureTemplate): Creature {
    return new Creature(t.name, t.attack, t.defense, t.hp, t.energy, t.abilities);
  }
}

class Construction {
  name:         string;
  defense:      number;
  base_hp:      number;
  remaining_hp: number;
  abilities:    Ability[];

  constructor(name: string, defense: number, hp: number, abilities: Ability[]) {
    this.name         = name;
    this.defense      = defense;
    this.base_hp      = hp;
    this.remaining_hp = hp;
    this.abilities    = abilities;
  }

  static from_template(t: ConstructionTemplate): Construction {
    return new Construction(t.name, t.defense, t.hp, t.abilities);
  }
}

interface Entity {
  id:          EntityId;
  controller:  PlayerId;
  description: string;
  entity:      Creature | Construction;
}

// ============================================================
// PLAYER STATE
// ============================================================

interface PlayerState {
  id:   PlayerId;
  mana: number;
}

// ============================================================
// GAME STATE
// ============================================================

const NUM_ROWS  = 5;
const NUM_COLS  = 5;
const NUM_CELLS = NUM_ROWS * NUM_COLS;

function coords_to_index(c: Coords): number {
  return c.x * NUM_ROWS + c.y;
}

function index_to_coords(i: number): Coords {
  return { x: Math.floor(i / NUM_ROWS), y: i % NUM_ROWS };
}

class GameState {
  private next_id: number = 0;
  grid:    (Entity | null)[];
  players: Record<PlayerId, PlayerState>;
  turn:    PlayerId = "A";
  log:     string[] = [];

  constructor() {
    this.grid = Array(NUM_CELLS).fill(null);
    this.players = {
      A: { id: "A", mana: 0 },
      B: { id: "B", mana: 0 },
    };
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  allEntities(): Entity[] {
    return this.grid.filter((e): e is Entity => e !== null);
  }

  getEntity(id: EntityId): Entity | null {
    return this.grid.find(e => e?.id === id) ?? null;
  }

  getEntityAt(c: Coords): Entity | null {
    return this.grid[coords_to_index(c)] ?? null;
  }

  findCoords(id: EntityId): Coords | null {
    const idx = this.grid.findIndex(e => e?.id === id);
    return idx === -1 ? null : index_to_coords(idx);
  }

  removeEntity(id: EntityId): void {
    const idx = this.grid.findIndex(e => e?.id === id);
    if (idx !== -1) this.grid[idx] = null;
  }

  placeEntity(entity: Entity, where: Coords): void {
    this.grid[coords_to_index(where)] = entity;
  }

  opponent(p: PlayerId): PlayerId {
    return p === "A" ? "B" : "A";
  }

  private emit(msg: string) {
    this.log.push(msg);
    console.log(`[LOG] ${msg}`);
  }

  // ----------------------------------------------------------
  // CORE EVENT ENGINE
  // ----------------------------------------------------------

  /**
   * The heart of the system.
   *
   * For each event in the queue:
   *   1. MODIFY phase  — every ability with a matching trigger
   *      and a `modify` hook runs. They may mutate the event
   *      in-place (e.g. reduce damage amount).
   *   2. RESOLVE phase — the engine applies the event's
   *      mechanical effect (deal damage, move, etc.).
   *   3. REACT phase   — every ability with a matching trigger
   *      and a `react` hook runs. Their returned events are
   *      appended to the queue (BFS ordering).
   *
   * This loop naturally handles arbitrarily deep chains.
   */
  triggerEvent(initial: GameEvent): void {
    const queue: GameEvent[] = [initial];

    while (queue.length > 0) {
      const event = queue.shift()!;

      // ── 1. MODIFY ──────────────────────────────────────────
      for (const entity of this.allEntities()) {
        for (const ability of entity.entity.abilities) {
          if (ability.trigger === event.trigger && ability.modify) {
            ability.modify(this, event, entity.id);
          }
        }
      }
      event._resolved = true;

      // ── 2. RESOLVE ─────────────────────────────────────────
      const followups = this.resolveEvent(event);

      // ── 3. REACT ───────────────────────────────────────────
      const reactions: GameEvent[] = [];
      for (const entity of this.allEntities()) {
        for (const ability of entity.entity.abilities) {
          if (ability.trigger === event.trigger && ability.react) {
            const more = ability.react(this, event, entity.id);
            reactions.push(...more);
          }
        }
      }

      // Enqueue: engine follow-ups first, then ability reactions.
      queue.push(...followups, ...reactions);
    }
  }

  /**
   * Mechanically applies a resolved event and returns any
   * additional events the engine itself needs to emit
   * (e.g. a death event after hp reaches 0).
   */
  private resolveEvent(event: GameEvent): GameEvent[] {
    const followups: GameEvent[] = [];

    if (event.log) this.emit(event.log);

    switch (event.trigger) {

      // ── Damage ─────────────────────────────────────────────
      case EventTime.take_damage: {
        const e = event as AmountEvent;
        const amount = Math.max(0, e.amount);
        if (typeof e.target === "number") {
          const entity = this.getEntity(e.target);
          if (entity) {
            entity.entity.remaining_hp -= amount;
            this.emit(`${entity.description} takes ${amount} damage → ${entity.entity.remaining_hp}/${entity.entity.base_hp} hp`);
            if (entity.entity.remaining_hp <= 0) {
              followups.push({
                trigger: EventTime.killed,
                source:  e.source,
                target:  e.target,
                log:     `${entity.description} was killed by ${e.source}`,
              });
            }
          }
        } else if (e.target === "player_A" || e.target === "player_B") {
          const pid = e.target === "player_A" ? "A" : "B" as PlayerId;
          this.players[pid].hp -= amount;
          this.emit(`Player ${pid} takes ${amount} damage → ${this.players[pid].hp} hp`);
        }
        break;
      }

      // ── Kill / remove entity ────────────────────────────────
      case EventTime.killed: {
        if (typeof event.target === "number") {
          this.removeEntity(event.target);
        }
        break;
      }

      // ── Move ───────────────────────────────────────────────
      case EventTime.moved: {
        const e = event as MoveEvent;
        if (typeof e.source === "number") {
          const entity = this.getEntity(e.source);
          if (entity) {
            this.removeEntity(e.source);
            this.placeEntity(entity, e.to);
            this.emit(`${entity.description} moved from (${e.from.x},${e.from.y}) to (${e.to.x},${e.to.y})`);
          }
        }
        break;
      }

      // ── Castle control ─────────────────────────────────────
      case EventTime.take_castle_control:
      case EventTime.lose_castle_control:
      case EventTime.change_castle_control: {
        const e = event as CastleEvent;
        this.emit(`Castle control changed from ${e.old_controller ?? "none"} → ${e.new_controller}`);
        break;
      }

      // ── Cast events — no mechanical effect, just logging ───
      case EventTime.cast:
      case EventTime.player_cast:
      case EventTime.player_cast_creature:
      case EventTime.player_cast_construction:
      case EventTime.player_cast_casting:
      case EventTime.opponent_cast:
      case EventTime.opponent_cast_creature:
      case EventTime.opponent_cast_construction:
      case EventTime.opponent_cast_casting: {
        const e = event as CastEvent;
        this.emit(`Cast event: ${event.trigger} by ${e.caster}`);
        break;
      }

      // ── Turn events — no mechanical effect ─────────────────
      case EventTime.owner_turn_start:
      case EventTime.opponent_turn_start:
      case EventTime.owner_turn_end:
      case EventTime.opponent_turn_end:
      case EventTime.played:
        break;
    }

    return followups;
  }

  // ----------------------------------------------------------
  // PUBLIC ACTIONS
  // ----------------------------------------------------------

  /**
   * Place an entity onto the grid and fire cast/played events.
   */
  spawn(template: CreatureTemplate | ConstructionTemplate, controller: PlayerId, where: Coords): Entity {
    const isCreature = "attack" in template;
    const entity: Entity = {
      id:          this.next_id++,
      controller,
      description: template.name,
      entity:      isCreature
        ? Creature.static_from(template as CreatureTemplate)
        : Construction.static_from(template as ConstructionTemplate),
    };
    this.placeEntity(entity, where);

    const castEvent: CastEvent = {
      trigger: isCreature ? EventTime.player_cast_creature : EventTime.player_cast_construction,
      source:  "player",
      target:  entity.id,
      caster:  controller,
      log:     `${controller} played ${template.name}`,
    };
    this.triggerEvent(castEvent);
    this.triggerEvent({ trigger: EventTime.played, source: "player", target: entity.id });
    return entity;
  }

  /**
   * One creature attacks another.
   * Both deal / take damage simultaneously.
   */
  attack(attackerId: EntityId, defenderId: EntityId): void {
    const attacker = this.getEntity(attackerId);
    const defender = this.getEntity(defenderId);
    if (!attacker || !defender) return;
    if (!(attacker.entity instanceof Creature)) return;

    const rawDamage = Math.max(0, attacker.entity.attack - (defender.entity.defense ?? 0));

    // Attacker fires deal_damage first so modifiers on the
    // defender (like damage shields) run during take_damage MODIFY.
    this.triggerEvent({
      trigger: EventTime.deal_damage,
      source:  attackerId,
      target:  defenderId,
      amount:  rawDamage,
      log:     `${attacker.description} attacks ${defender.description} for ${rawDamage}`,
    } as AmountEvent);

    this.triggerEvent({
      trigger: EventTime.take_damage,
      source:  attackerId,
      target:  defenderId,
      amount:  rawDamage,
    } as AmountEvent);
  }

  /**
   * Move an entity to a new position.
   */
  move(entityId: EntityId, to: Coords): void {
    const from = this.findCoords(entityId);
    if (!from) return;
    this.triggerEvent({
      trigger: EventTime.moved,
      source:  entityId,
      target:  "none",
      from,
      to,
    } as MoveEvent);
  }

  /**
   * Advance to the next turn, firing all turn-boundary events.
   */
  nextTurn(): void {
    const current  = this.turn;
    const opponent = this.opponent(current);

    // End-of-turn events for the current player's entities.
    for (const entity of this.allEntities()) {
      const trigger = entity.controller === current
        ? EventTime.owner_turn_end
        : EventTime.opponent_turn_end;
      this.triggerEvent({ trigger, source: entity.id, target: entity.id });
    }

    this.turn = opponent;

    // Start-of-turn events for the new current player's entities.
    for (const entity of this.allEntities()) {
      const trigger = entity.controller === this.turn
        ? EventTime.owner_turn_start
        : EventTime.opponent_turn_start;
      this.triggerEvent({ trigger, source: entity.id, target: entity.id });
    }

    // Refresh energy for creatures belonging to new current player.
    for (const entity of this.allEntities()) {
      if (entity.controller === this.turn && entity.entity instanceof Creature) {
        entity.entity.energy_remaining = entity.entity.base_energy;
      }
    }
  }
}

// Monkey-patch static factory helpers so Creature/Construction
// don't reference themselves during class definition.
(Creature as any).static_from = Creature.from_template;
(Construction as any).static_from = Construction.from_template;

// ============================================================
// EXAMPLE ABILITIES
// (No if-statements in the engine — all logic lives here)
// ============================================================

/**
 * "At the start of the turn, heal friendly creatures by 2."
 * Trigger: owner_turn_start
 * React: emit take_damage with negative amount (a heal) for
 *        every friendly creature.  We use a negative
 *        take_damage event so the resolution logic clamps at
 *        base_hp.  Alternatively you could add an on_heal
 *        trigger — the system supports it trivially.
 */
export const healingAura: Ability = {
  name:    "Healing Aura",
  trigger: EventTime.owner_turn_start,
  react(state, _event, selfId): GameEvent[] {
    const owner  = state.getEntity(selfId)?.controller;
    if (!owner) return [];
    return state.allEntities()
      .filter(e => e.controller === owner && e.entity instanceof Creature)
      .map(e => ({
        trigger: EventTime.take_damage,
        source:  selfId,
        target:  e.id,
        amount:  -2,     // negative = healing in resolve logic
        log:     `Healing Aura heals ${e.description} for 2`,
      } as AmountEvent));
  },
};

/**
 * "Reduce all incoming damage by 1."
 * Trigger: take_damage on self
 * Modify:  decrement amount before the event resolves.
 */
export const damageShield: Ability = {
  name:    "Damage Shield",
  trigger: EventTime.take_damage,
  modify(state, event, selfId): void {
    const e = event as AmountEvent;
    // Only intercept damage aimed at this entity.
    if (e.target !== selfId) return;
    // Don't reduce healing.
    if (e.amount <= 0)        return;
    e.amount = Math.max(0, e.amount - 1);
    state.log.push(`Damage Shield absorbs 1 damage on entity ${selfId}`);
  },
};

/**
 * "When this creature dies, its killer also dies."
 * Trigger: killed (self)
 * React:   emit a killed event targeting the source of the
 *          killing blow.
 */
export const deathCurse: Ability = {
  name:    "Death Curse",
  trigger: EventTime.killed,
  react(state, event, selfId): GameEvent[] {
    if (event.target !== selfId)           return [];
    if (typeof event.source !== "number")  return [];
    const killer = state.getEntity(event.source);
    if (!killer)                           return [];
    return [{
      trigger: EventTime.killed,
      source:  selfId,
      target:  event.source,
      log:     `${killer.description} is cursed to die with its victim!`,
    }];
  },
};

/**
 * "When this creature dies, gain 2 mana."
 * Trigger: killed (self)
 * React:   directly adds mana to the owner; no event needed
 *          since mana changes have no further triggers in
 *          this example — add an on_gain_mana trigger if you want.
 */
export const gainManaOnDeath: Ability = {
  name:    "Soul Harvest",
  trigger: EventTime.killed,
  react(state, event, selfId): GameEvent[] {
    if (event.target !== selfId) return [];
    const entity = state.getEntity(selfId);
    // Entity is being removed this tick; check by id.
    const controller = entity?.controller
      ?? state.allEntities().find(e => e.id === selfId)?.controller;
    if (!controller) return [];
    state.players[controller].mana += 2;
    state.log.push(`Soul Harvest: ${controller} gains 2 mana (now ${state.players[controller].mana})`);
    return [];
  },
};

/**
 * "At the end of the opponent's turn, deal 1 damage to a
 *  random enemy creature."
 * Trigger: opponent_turn_end
 * React:   pick a random enemy and emit take_damage.
 */
export const thornAura: Ability = {
  name:    "Thorn Aura",
  trigger: EventTime.opponent_turn_end,
  react(state, _event, selfId): GameEvent[] {
    const owner   = state.getEntity(selfId)?.controller;
    if (!owner) return [];
    const enemies = state.allEntities()
      .filter(e => e.controller !== owner && e.entity instanceof Creature);
    if (enemies.length === 0) return [];
    const target = enemies[Math.floor(Math.random() * enemies.length)];
    return [{
      trigger: EventTime.take_damage,
      source:  selfId,
      target:  target.id,
      amount:  1,
      log:     `Thorn Aura pricks ${target.description} for 1`,
    } as AmountEvent];
  },
};

/**
 * "When an allied creature is cast, buff this creature's
 *  attack by 1."
 * Trigger: player_cast_creature
 * React:   increase own attack stat directly.
 */
export const warCry: Ability = {
  name:    "War Cry",
  trigger: EventTime.player_cast_creature,
  react(state, event, selfId): GameEvent[] {
    const self  = state.getEntity(selfId);
    const caste = event as CastEvent;
    // Only fire for allies, not self.
    if (!self || caste.caster !== self.controller) return [];
    if (event.target === selfId)                   return [];
    if (!(self.entity instanceof Creature))        return [];
    self.entity.attack += 1;
    state.log.push(`War Cry: ${self.description}'s attack rises to ${self.entity.attack}`);
    return [];
  },
};

/**
 * "When a castle changes control, deal 3 damage to the
 *  player who lost it."
 * Trigger: change_castle_control
 * React:   emit take_damage targeting the losing player.
 */
export const castleVengeance: Ability = {
  name:    "Castle Vengeance",
  trigger: EventTime.change_castle_control,
  react(_state, event, selfId): GameEvent[] {
    const e = event as CastleEvent;
    if (!e.old_controller) return [];
    const target: EventTarget = e.old_controller === "A" ? "player_A" : "player_B";
    return [{
      trigger: EventTime.take_damage,
      source:  selfId,
      target,
      amount:  3,
      log:     `Castle Vengeance deals 3 damage to player ${e.old_controller}`,
    } as AmountEvent];
  },
};

// ============================================================
// EXAMPLE TEMPLATES
// ============================================================

export const CursedWarriorTemplate: CreatureTemplate = {
  name:      "Cursed Warrior",
  cost:      3,
  attack:    4,
  defense:   1,
  hp:        5,
  energy:    1,
  abilities: [deathCurse],
};

export const SoulHarvesterTemplate: CreatureTemplate = {
  name:      "Soul Harvester",
  cost:      2,
  attack:    2,
  defense:   0,
  hp:        3,
  energy:    1,
  abilities: [gainManaOnDeath],
};

export const HealerTemplate: CreatureTemplate = {
  name:      "Healer",
  cost:      4,
  attack:    1,
  defense:   1,
  hp:        4,
  energy:    1,
  abilities: [healingAura],
};

export const ShieldBearerTemplate: CreatureTemplate = {
  name:      "Shield Bearer",
  cost:      2,
  attack:    2,
  defense:   2,
  hp:        6,
  energy:    1,
  abilities: [damageShield],
};

// ============================================================
// DEMO
// ============================================================

function demo() {
  const state = new GameState();
  console.log("=== GAME START ===");

  const healer  = state.spawn(HealerTemplate,        "A", { x: 0, y: 0 });
  const warrior = state.spawn(CursedWarriorTemplate, "A", { x: 1, y: 0 });
  const shield  = state.spawn(ShieldBearerTemplate,  "B", { x: 2, y: 0 });
  const soul    = state.spawn(SoulHarvesterTemplate, "B", { x: 3, y: 0 });

  console.log("\n=== Player A turn start ===");
  state.nextTurn(); // A→B, fires turn events which trigger healingAura

  console.log("\n=== Cursed Warrior attacks Soul Harvester ===");
  // Soul Harvester has no protection: should die, granting B 2 mana.
  state.attack(warrior.id, soul.id);

  console.log("\n=== Shield Bearer attacks Cursed Warrior ===");
  // Cursed Warrior (deathCurse) should take fatal damage and drag
  // Shield Bearer down with it via the chain.
  state.attack(shield.id, warrior.id);

  console.log("\n=== Final State ===");
  console.log("Mana A:", state.players.A.mana);
  console.log("Mana B:", state.players.B.mana);
  console.log("Entities on grid:", state.allEntities().map(e => e.description));
}

demo();
