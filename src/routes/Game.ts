export const cardKindVariants: CardType[] = ["creature", "construction", "casting"];

const STARTING_MANA = 4;

type EntityId   = number;
type LogMessage = string | null;
type EventSource = EntityId | "player" | "system";
type EventTarget = EntityId | "player_A" | "player_B" | "all" | "none";

export type PlayCardResult = "ok" | "not_enough_mana" | "invalid_coords";
export type PlayerId       = "A" | "B";
export type CardType = "creature" | "construction" | "casting";

export interface Coords {
  x: number;
  y: number;
}

// ============================================================
// UTILITIES
// ============================================================

export const NUM_ROWS  = 5;
export const NUM_COLS  = 5;
export const NUM_CELLS = NUM_ROWS * NUM_COLS;

export function coords_to_index(c: Coords): number {
  return c.x * NUM_ROWS + c.y;
}

export function index_to_coords(i: number): Coords {
  return { x: Math.floor(i / NUM_ROWS), y: i % NUM_ROWS };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// EVENT TRIGGERS
// ============================================================

export const EventTime = {
  deal_damage:                "on_deal_damage",
  take_damage:                "on_take_damage",
  played:                     "on_played",
  killed:                     "on_killed",
  moved:                      "on_moved",
  owner_turn_start:           "on_owner_turn_start",
  opponent_turn_start:        "on_opponent_turn_start",
  owner_turn_end:             "on_owner_turn_end",
  opponent_turn_end:          "on_opponent_turn_end",
  cast:                       "on_cast",
  player_cast:                "on_player_cast",
  player_cast_creature:       "on_player_cast_creature",
  player_cast_construction:   "on_player_cast_construction",
  player_cast_casting:        "on_player_cast_casting",
  opponent_cast:              "on_opponent_cast",
  opponent_cast_creature:     "on_opponent_cast_creature",
  opponent_cast_construction: "on_opponent_cast_construction",
  opponent_cast_casting:      "on_opponent_cast_casting",
  take_castle_control:        "on_take_castle_control",
  lose_castle_control:        "on_lose_castle_control",
  change_castle_control:      "on_change_castle_control",
} as const;

export type EventTime = typeof EventTime[keyof typeof EventTime];

// ============================================================
// EVENTS
// ============================================================

interface BaseEvent {
  trigger:    EventTime;
  source:     EventSource;
  target:     EventTarget;
  log?:       LogMessage;
  _resolved?: boolean;
}

interface AmountEvent extends BaseEvent {
  amount: number;
}

interface MoveEvent extends BaseEvent {
  from: Coords;
  to:   Coords;
}

interface CastEvent extends BaseEvent {
  caster: PlayerId;
}

interface CastleEvent extends BaseEvent {
  new_controller: PlayerId;
  old_controller: PlayerId | null;
}

export type GameEvent = AmountEvent | MoveEvent | CastEvent | CastleEvent | BaseEvent;

// ============================================================
// ABILITIES
// ============================================================

export interface Ability {
  trigger: EventTime;
  name:    string;

  /** MODIFY phase — mutate the event before it resolves. */
  modify?: (state: GameState, event: GameEvent, selfId: EntityId) => void;

  /** REACT phase — fire after the event resolves; return follow-up events. */
  react?:  (state: GameState, event: GameEvent, selfId: EntityId) => GameEvent[];
}

// ============================================================
// TEMPLATES & ENTITIES
// ============================================================

export interface Playable {
  cost: number;
  kind: CardType;
  name: string;
}

export interface CreatureTemplate extends Playable {
  kind: "creature";
  name:      string;
  cost:      number;
  attack:    number;
  defense:   number;
  hp:        number;
  energy:    number;
  abilities: Ability[];
  // UI-only metadata
  icon?:     string;
  color?:    string;
  rarity?:   "common" | "uncommon" | "rare" | "legendary";
  flavor?:   string;
}

export interface ConstructionTemplate extends Playable {
  kind: "construction";
  name:      string;
  cost:      number;
  defense:   number;
  hp:        number;
  abilities: Ability[];
  // UI-only metadata
  icon?:     string;
  color?:    string;
  rarity?:   "common" | "uncommon" | "rare" | "legendary";
  flavor?:   string;
}

export class Creature {
  kind: CardType = "creature";
  name:             string;
  attack:           number;
  defense:          number;
  base_hp:          number;
  remaining_hp:     number;
  base_energy:      number;
  energy_remaining: number;
  abilities:        Ability[];

  constructor(name: string, attack: number, defense: number, hp: number, energy: number, abilities: Ability[]) {
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

export class Construction {
  kind: CardType = "construction";
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

export interface Entity {
  id:          EntityId;
  controller:  PlayerId;
  description: string;
  entity:      Creature | Construction;
}

// ============================================================
// PLAYER STATE
// ============================================================

export class PlayerState {
  id:           PlayerId;
  mana:         number;
  castleHolds:  number;

  constructor (id: PlayerId, mana: number, castleHolds: number) {
    this.id = id;
    this.mana = mana;
    this.castleHolds = castleHolds;
  }
}

export class Deck {
  cards: Record<CardType, Playable[]>;
  i_vals: Record<CardType, number> = {
    casting: 0,
    creature: 0,
    construction: 0,
  };

  constructor (
    creatures: CreatureTemplate[],
    constructions: ConstructionTemplate[],
    castings: CastingTemplate[],
  ) {
      this.cards = {
        casting: castings,
        creature: creatures,
        construction: constructions,
      };
  }

  clone(): Deck {
    const newDeck = new Deck(
      this.cards['creature'] as CreatureTemplate[],
      this.cards['construction'] as ConstructionTemplate[],
      this.cards['casting'] as CastingTemplate[],
    );

    // reset or copy indices depending on your intent
    newDeck.i_vals = { ...this.i_vals };

    return newDeck;
  }

  draw (kind: CardType): Playable {
    let i = this.i_vals[kind];
    this.i_vals[kind]++;

    let mod = this.cards[kind].length;
    return this.cards[kind][i % mod];
  }

  numCards(): number {
    let n = 0;
    for (const v of cardKindVariants) {
      n += this.cards[v].length;
    }

    return n;
  }
}

// ============================================================
// GAME STATE
// ============================================================

const HAND_SIZE = 4;

export class GameState {
  private next_id:  number = 0;
  turnNumber:       number = 1;
  grid:             (Entity | null)[];
  players:          Record<PlayerId, PlayerState>;
  /** Current hand for each player. */
  decks: Record<PlayerId, Deck>;
  reserves: Record<PlayerId, Deck>;
  /** Remaining draw pile for each player. */
  turn:             PlayerId = "A";
  log:              string[] = [];

  /**
   * @param shuffledDeck  A pre-shuffled deck that BOTH players will share
   *                      (cloned for each player). The first HAND_SIZE cards
   *                      become the opening hand; the rest are the draw pile.
   */
  constructor(
    shuffledDeck: Deck,
  ) {
    this.grid = Array(NUM_CELLS).fill(null);

    this.decks = {
      A: shuffledDeck.clone(),
      B: shuffledDeck.clone(),
    };

    this.reserves = {
      A: new Deck([], [], []),
      B: new Deck([], [], []),
    };

    for (let i = 0; i < HAND_SIZE; i++) {
      for (let j = 0; j < 2; j++) {
        let p: PlayerId = j == 0 ? 'A' : 'B';
        for (const v of cardKindVariants) {
          this.reserves[p].cards[v].push(this.decks[p].draw(v));
        }
      }
    }

    this.players = {
      A: new PlayerState('A', STARTING_MANA, 0),
      B: new PlayerState('B', STARTING_MANA, 0),
    };
  }

  // ----------------------------------------------------------
  // ENTITY HELPERS
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

  get_controller(id: EntityId): PlayerId | null {
    return this.getEntity(id)?.controller ?? null;
  }

  can_control(id: EntityId): boolean {
    return this.get_controller(id) === this.turn;
  }

  // ----------------------------------------------------------
  // CARD MANAGEMENT
  // ----------------------------------------------------------

  /** Draw the top card of pid's deck into their hand. Returns true if a card was drawn. */
  draw (idx: number, kind: CardType) {
    this.reserves[this.turn].cards[kind][idx] = this.decks[this.turn].draw(kind);
  }

  /**
   * Play a card from the active player's hand onto the board.
   * - Creatures / constructions: placed on the target empty cell.
   * - Castings: instant effect; `where` identifies the target entity (cell may be occupied).
   */
  play (cardIndex: number, where: Coords, kind: CardType): PlayCardResult {
    const card = this.reserves[this.turn].cards[kind][cardIndex];
    if (!card) return "invalid_coords";

    const n = coords_to_index(where);
    if (n < 0 || n >= NUM_CELLS) return "invalid_coords";
    if (card.cost > this.players[this.turn].mana) return "not_enough_mana";

    const entityAt = this.getEntityAt(where);

    // ── Casting (instant spell) ─────────────────────────────
    if (card.kind === "casting") {
      const casting = card as CastingTemplate;
      this.players[this.turn].mana -= card.cost;
      this.emit(`${this.turn} cast ${casting.name}.`);
      const followups = casting.onPlay(this, this.turn, entityAt?.id);
      for (const ev of followups) this.triggerEvent(ev);
      return "ok";
    }

    // ── Creature / Construction (placed on board) ───────────
    if (entityAt) return "invalid_coords";   // cell must be empty
    this.players[this.turn].mana -= card.cost;
    this.spawn(card as (CreatureTemplate | ConstructionTemplate), this.turn, where);

    this.draw(cardIndex, kind);
    return "ok";
  }

  // ----------------------------------------------------------
  // CORE EVENT ENGINE
  // ----------------------------------------------------------

  /**
   * Process a single event through three phases:
   *   1. MODIFY  — abilities may mutate the event in-place.
   *   2. RESOLVE — the engine applies the event's effect.
   *   3. REACT   — abilities return follow-up events (BFS).
   */
  triggerEvent(initial: GameEvent): void {
    const queue: GameEvent[] = [initial];

    while (queue.length > 0) {
      const event = queue.shift()!;

      // ── 1. MODIFY ─────────────────────────────────────────
      for (const entity of this.allEntities()) {
        for (const ab of entity.entity.abilities) {
          if (ab.trigger === event.trigger && ab.modify) {
            ab.modify(this, event, entity.id);
          }
        }
      }
      event._resolved = true;

      // ── 2. RESOLVE ────────────────────────────────────────
      const followups = this.resolveEvent(event);

      // ── 3. REACT ──────────────────────────────────────────
      const reactions: GameEvent[] = [];
      for (const entity of this.allEntities()) {
        for (const ab of entity.entity.abilities) {
          if (ab.trigger === event.trigger && ab.react) {
            reactions.push(...ab.react(this, event, entity.id));
          }
        }
      }

      queue.push(...followups, ...reactions);
    }
  }

  private resolveEvent(event: GameEvent): GameEvent[] {
    const followups: GameEvent[] = [];
    if (event.log) this.emit(event.log);

    switch (event.trigger) {

      // ── Damage / Healing ───────────────────────────────────
      case EventTime.take_damage: {
        const e = event as AmountEvent;
        if (typeof e.target === "number") {
          const entity = this.getEntity(e.target);
          if (entity) {
            if (e.amount > 0) {
              // Damage
              entity.entity.remaining_hp -= e.amount;
              this.emit(`${entity.description} takes ${e.amount} damage → ${entity.entity.remaining_hp}/${entity.entity.base_hp} hp`);
              if (entity.entity.remaining_hp <= 0) {
                followups.push({
                  trigger: EventTime.killed,
                  source:  e.source,
                  target:  e.target,
                  log:     `${entity.description} was killed.`,
                });
              }
            } else if (e.amount < 0) {
              // Healing (negative amount)
              const heal = -e.amount;
              entity.entity.remaining_hp = Math.min(entity.entity.base_hp, entity.entity.remaining_hp + heal);
              this.emit(`${entity.description} heals ${heal} → ${entity.entity.remaining_hp}/${entity.entity.base_hp} hp`);
            }
          }
        }
        break;
      }

      // ── Kill / remove entity ───────────────────────────────
      case EventTime.killed: {
        if (typeof event.target === "number") {
          this.removeEntity(event.target);
        }
        break;
      }

      // ── Move ──────────────────────────────────────────────
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

      // ── Castle control ────────────────────────────────────
      case EventTime.take_castle_control:
      case EventTime.lose_castle_control:
      case EventTime.change_castle_control: {
        const e = event as CastleEvent;
        this.emit(`Castle control: ${e.old_controller ?? "none"} → ${e.new_controller}`);
        break;
      }

      // ── Cast events — logging only ─────────────────────────
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
        this.emit(`${e.caster} cast: ${event.trigger}`);
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

  /** Place an entity onto the grid and fire cast/played events. */
  spawn(template: CreatureTemplate | ConstructionTemplate, controller: PlayerId, where: Coords): Entity {
    const isCreature = "attack" in template;
    const entity: Entity = {
      id:          this.next_id++,
      controller,
      description: template.name,
      entity:      isCreature
        ? Creature.from_template(template as CreatureTemplate)
        : Construction.from_template(template as ConstructionTemplate),
    };
    this.placeEntity(entity, where);

    // Helper — builds a CastEvent for this entity without repetition.
    const castEvt = (trigger: EventTime, log?: string): GameEvent => ({
      trigger, source: "player", target: entity.id, caster: controller, log,
    } as CastEvent);

    const specificPlayerTrigger = isCreature
      ? EventTime.player_cast_creature
      : EventTime.player_cast_construction;
    const specificOpponentTrigger = isCreature
      ? EventTime.opponent_cast_creature
      : EventTime.opponent_cast_construction;

    this.triggerEvent(castEvt(EventTime.cast, `${controller} played ${template.name}.`));
    this.triggerEvent(castEvt(EventTime.player_cast));
    this.triggerEvent(castEvt(specificPlayerTrigger));
    this.triggerEvent(castEvt(EventTime.opponent_cast));
    this.triggerEvent(castEvt(specificOpponentTrigger));
    this.triggerEvent({ trigger: EventTime.played, source: "player", target: entity.id });
    return entity;
  }

  /**
   * One creature attacks another — simultaneous damage exchange.
   * Consumes 1 energy from the attacker.
   */
  attack(attackerId: EntityId, defenderId: EntityId): void {
    const attacker = this.getEntity(attackerId);
    const defender = this.getEntity(defenderId);
    if (!attacker || !defender) return;
    if (!(attacker.entity instanceof Creature)) return;
    if (attacker.entity.energy_remaining <= 0) return;

    attacker.entity.energy_remaining--;

    const atkDmg = Math.max(0, attacker.entity.attack - defender.entity.defense);

    this.triggerEvent({
      trigger: EventTime.deal_damage,
      source:  attackerId,
      target:  defenderId,
      amount:  atkDmg,
      log:     `${attacker.description} attacks ${defender.description} for ${atkDmg}.`,
    } as AmountEvent);

    this.triggerEvent({
      trigger: EventTime.take_damage,
      source:  attackerId,
      target:  defenderId,
      amount:  atkDmg,
    } as AmountEvent);
  }

  /** Move an entity to a new cell. Costs 1 energy (same as attacking). */
  move(entityId: EntityId, to: Coords): void {
    const entity = this.getEntity(entityId);
    if (!entity) return;
    // Energy check — only Creatures spend energy to act.
    if (entity.entity instanceof Creature) {
      if (entity.entity.energy_remaining <= 0) return;
      entity.entity.energy_remaining--;
    }
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
   * Advance to the next turn.
   * Fires end-of-turn events, scales mana, resets energy, fires start-of-turn events, draws a card.
   */
  nextTurn(): void {
    const current  = this.turn;
    const opponent = this.opponent(current);

    // End-of-turn events
    for (const entity of this.allEntities()) {
      const trigger = entity.controller === current
        ? EventTime.owner_turn_end
        : EventTime.opponent_turn_end;
      this.triggerEvent({ trigger, source: entity.id, target: entity.id });
    }

    this.turn = opponent;
    this.turnNumber++;

    // Mana ramp: starts at 3, gains 1 every 2 turns, capped at 10
    this.players[opponent].mana = Math.min(10, 3 + Math.floor(this.turnNumber / 2));

    // Refresh energy for the new active player's creatures
    for (const entity of this.allEntities()) {
      if (entity.controller === this.turn && entity.entity instanceof Creature) {
        entity.entity.energy_remaining = entity.entity.base_energy;
      }
    }

    // Start-of-turn events
    for (const entity of this.allEntities()) {
      const trigger = entity.controller === this.turn
        ? EventTime.owner_turn_start
        : EventTime.opponent_turn_start;
      this.triggerEvent({ trigger, source: entity.id, target: entity.id });
    }

    this.emit(`--- Turn ${this.turnNumber}: Player ${this.turn} (${this.players[this.turn].mana} mana) ---`);
  }

  private emit(msg: string): void {
    this.log.push(msg);
  }
}

// ============================================================
// ABILITIES
// ============================================================

export const healingAura: Ability = {
  name:    "Healing Aura",
  trigger: EventTime.owner_turn_start,
  react(state, _event, selfId): GameEvent[] {
    const owner = state.getEntity(selfId)?.controller;
    if (!owner) return [];
    return state.allEntities()
      .filter(e => e.controller === owner && e.entity instanceof Creature)
      .map(e => ({
        trigger: EventTime.take_damage,
        source:  selfId,
        target:  e.id,
        amount:  -2,
        log:     `Healing Aura restores 2 hp to ${e.description}.`,
      } as AmountEvent));
  },
};

export const damageShield: Ability = {
  name:    "Damage Shield",
  trigger: EventTime.take_damage,
  modify(state, event, selfId): void {
    const e = event as AmountEvent;
    if (e.target !== selfId) return;
    if (e.amount <= 0)       return;
    e.amount = Math.max(0, e.amount - 1);
    state.log.push(`Damage Shield absorbs 1 damage on entity ${selfId}.`);
  },
};

export const deathCurse: Ability = {
  name:    "Death Curse",
  trigger: EventTime.killed,
  react(state, event, selfId): GameEvent[] {
    if (event.target !== selfId)          return [];
    if (typeof event.source !== "number") return [];
    const killer = state.getEntity(event.source);
    if (!killer)                          return [];
    return [{
      trigger: EventTime.killed,
      source:  selfId,
      target:  event.source,
      log:     `Death Curse drags ${killer.description} to the grave!`,
    }];
  },
};

export const gainManaOnDeath: Ability = {
  name:    "Soul Harvest",
  trigger: EventTime.killed,
  react(state, event, selfId): GameEvent[] {
    if (event.target !== selfId) return [];
    const entity = state.getEntity(selfId)
      ?? state.allEntities().find(e => e.id === selfId);
    const controller = entity?.controller;
    if (!controller) return [];
    state.players[controller].mana += 2;
    state.log.push(`Soul Harvest: ${controller} gains 2 mana (now ${state.players[controller].mana}).`);
    return [];
  },
};

export const thornAura: Ability = {
  name:    "Thorn Aura",
  trigger: EventTime.opponent_turn_end,
  react(state, _event, selfId): GameEvent[] {
    const owner = state.getEntity(selfId)?.controller;
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
      log:     `Thorn Aura pricks ${target.description} for 1.`,
    } as AmountEvent];
  },
};

export const warCry: Ability = {
  name:    "War Cry",
  trigger: EventTime.player_cast_creature,
  react(state, event, selfId): GameEvent[] {
    const self  = state.getEntity(selfId);
    const caste = event as CastEvent;
    if (!self || caste.caster !== self.controller) return [];
    if (event.target === selfId)                   return [];
    if (!(self.entity instanceof Creature))        return [];
    self.entity.attack += 1;
    state.log.push(`War Cry: ${self.description}'s attack rises to ${self.entity.attack}.`);
    return [];
  },
};

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
      log:     `Castle Vengeance deals 3 damage to player ${e.old_controller}.`,
    } as AmountEvent];
  },
};

// ============================================================
// CREATURE TEMPLATES
// ============================================================

export const CursedWarriorTemplate: CreatureTemplate = {
  kind: "creature",
  name: "Cursed Warrior", cost: 3,
  attack: 4, defense: 1, hp: 5, energy: 1,
  abilities: [deathCurse],
  icon: "ra-axe", color: "#c05555", rarity: "rare",
  flavor: "Death follows in its wake.",
};

export const SoulHarvesterTemplate: CreatureTemplate = {
  kind: "creature",
  name: "Soul Harvester", cost: 2,
  attack: 2, defense: 0, hp: 3, energy: 1,
  abilities: [gainManaOnDeath],
  icon: "ra-skull", color: "#9060c0", rarity: "uncommon",
  flavor: "It feeds on the moment of passing.",
};

export const HealerTemplate: CreatureTemplate = {
  kind: "creature",
  name: "Healer", cost: 4,
  attack: 1, defense: 1, hp: 4, energy: 1,
  abilities: [healingAura],
  icon: "ra-angel-wings", color: "#50b080", rarity: "uncommon",
  flavor: "Light pours from every wound it touches.",
};

export const ShieldBearerTemplate: CreatureTemplate = {
  kind: "creature",
  name: "Shield Bearer", cost: 2,
  attack: 2, defense: 2, hp: 6, energy: 1,
  abilities: [damageShield],
  icon: "ra-shield", color: "#4080c0", rarity: "common",
  flavor: "No blade has found its mark. Not yet.",
};

export const ThornWatcherTemplate: CreatureTemplate = {
  kind: "creature",
  name: "Thorn Watcher", cost: 3,
  attack: 1, defense: 1, hp: 4, energy: 1,
  abilities: [thornAura],
  icon: "ra-thorned-arrow", color: "#80a040", rarity: "uncommon",
  flavor: "Stand too close and bleed.",
};

export const WarChieftainTemplate: CreatureTemplate = {
  kind: "creature",
  name: "War Chieftain", cost: 4,
  attack: 3, defense: 1, hp: 4, energy: 1,
  abilities: [warCry],
  icon: "ra-viking-head", color: "#c08040", rarity: "rare",
  flavor: "One roar and the whole army surges forward.",
};

/** All available creature templates. */
export const creatures: CreatureTemplate[] = [
  CursedWarriorTemplate,
  SoulHarvesterTemplate,
  HealerTemplate,
  ShieldBearerTemplate,
  ThornWatcherTemplate,
  WarChieftainTemplate,
];

// ============================================================
// CASTING TEMPLATE — instant one-time-use spells
// ============================================================

export interface CastingTemplate extends Playable {
  kind: "casting";
  name:      string;
  cost:      number;
  /** Called immediately when the card is played. Returns follow-up events. */
  onPlay:    (state: GameState, caster: PlayerId, target?: EntityId) => GameEvent[];
  // UI-only metadata
  icon?:     string;
  color?:    string;
  rarity?:   "common" | "uncommon" | "rare" | "legendary";
  flavor?:   string;
}

// ============================================================
// CONSTRUCTION ABILITIES
// ============================================================

type Direction = "north" | "east" | "west" | "south";

function getDirection(from: Coords, to: Coords): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy < 0) return "north";
  if (dx > 0 && dy === 0) return "east";
  if (dx < 0 && dy === 0) return "west";
  if (dx === 0 && dy > 0) return "south";

  return null;
}

const directionPriority: Record<Direction, number> = {
  north: 0,
  east: 1,
  west: 2,
  south: 3,
};

export function findNearestCoord(
  origin: Coords,
  candidates: Coords[]
): Coords | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, curr) => {
    const bestDist =
      Math.abs(best.x - origin.x) + Math.abs(best.y - origin.y);
    const currDist =
      Math.abs(curr.x - origin.x) + Math.abs(curr.y - origin.y);

    if (currDist < bestDist) return curr;
    if (currDist > bestDist) return best;

    const bestDir = getDirection(origin, best);
    const currDir = getDirection(origin, curr);

    const bestScore =
      bestDir !== null ? directionPriority[bestDir] : Number.MAX_SAFE_INTEGER;
    const currScore =
      currDir !== null ? directionPriority[currDir] : Number.MAX_SAFE_INTEGER;

    return currScore < bestScore ? curr : best;
  });
}

export const coveringFire: Ability = {
  name: "Covering Fire",
  trigger: EventTime.owner_turn_start,

  react(state, _event, selfId): GameEvent[] {
    const self = state.getEntity(selfId);
    const origin = state.findCoords(selfId);
    if (!self || !origin) return [];

    const enemyCoords: Coords[] = [];

    for (let y = 0; y < NUM_ROWS; y++) {
      for (let x = 0; x < NUM_COLS; x++) {
        const entity = state.getEntityAt({ x, y });
        if (!entity || entity.controller === self.controller) continue;
        enemyCoords.push({ x, y });
      }
    }

    const targetCoord = findNearestCoord(origin, enemyCoords);
    if (!targetCoord) return [];

    const target = state.getEntityAt(targetCoord);
    if (!target) return [];

    return [
      {
        trigger: EventTime.take_damage,
        source: selfId,
        target: target.id,
        amount: 1,
        log: `Covering Fire snipes ${target.description} for 1.`,
      } as AmountEvent,
    ];
  },
};

/** At the start of your turn, generate +1 mana. */
export const manaSpring: Ability = {
  name:    "Mana Spring",
  trigger: EventTime.owner_turn_start,
  react(state, _event, selfId): GameEvent[] {
    const owner = state.getEntity(selfId)?.controller;
    if (!owner) return [];
    state.players[owner].mana += 1;
    state.log.push(`Mana Spring trickles 1 mana to player ${owner} (now ${state.players[owner].mana}).`);
    return [];
  },
};

// ============================================================
// CONSTRUCTION TEMPLATES
// ============================================================

export const SniperTowerTemplate: ConstructionTemplate = {
  kind:      "construction",
  name:      "Sniper Tower",
  cost:      3,
  defense:   2,
  hp:        6,
  abilities: [coveringFire],
  icon:      "ra-tower",
  color:     "#708060",
  rarity:    "uncommon",
  flavor:    "Patience is its only ammunition.",
};

export const ManaConduitTemplate: ConstructionTemplate = {
  kind:      "construction",
  name:      "Mana Conduit",
  cost:      6,
  defense:   1,
  hp:        4,
  abilities: [manaSpring],
  icon:      "ra-crystal-ball",
  color:     "#6050a0",
  rarity:    "uncommon",
  flavor:    "It hums with borrowed power.",
};

export const constructions: ConstructionTemplate[] = [
  SniperTowerTemplate,
  ManaConduitTemplate,
];

// ============================================================
// CASTING TEMPLATES (instant, no entity placed on board)
// ============================================================

/** Deal 10 damage to target creature. */
export const LightningBoltTemplate: CastingTemplate = {
  kind: "casting",
  name:   "Lightning Bolt",
  cost:   4,
  onPlay(state, _caster, target): GameEvent[] {
    if (target === undefined) return [];
    return [{
      trigger: EventTime.take_damage,
      source:  "player",
      target,
      amount:  10,
      log:     `Lightning Bolt strikes ${state.getEntity(target)?.description ?? target} for 10!`,
    } as AmountEvent];
  },
  icon:   "ra-lightning-bolt",
  color:  "#c0a020",
  rarity: "rare",
  flavor: "No defense survives a direct strike from the sky.",
};

/** Restore a friendly creature to full energy. */
export const HasteTemplate: CastingTemplate = {
  kind: "casting",
  name:   "Haste",
  cost:   2,
  onPlay(state, _caster, target): GameEvent[] {
    if (target === undefined) return [];
    const entity = state.getEntity(target);
    if (!entity || !(entity.entity instanceof Creature)) return [];
    entity.entity.energy_remaining = entity.entity.base_energy;
    state.log.push(`Haste restores ${entity.description} to full energy (${entity.entity.base_energy}).`);
    return [];
  },
  icon:   "ra-lightning-storm",
  color:  "#2080c0",
  rarity: "uncommon",
  flavor: "Move again. The enemy won't see it coming.",
};

/** Restore a friendly creature to full HP. */
export const MendTemplate: CastingTemplate = {
  kind: "casting",
  name:   "Mend",
  cost:   3,
  onPlay(state, _caster, target): GameEvent[] {
    if (target === undefined) return [];
    const entity = state.getEntity(target);
    if (!entity) return [];
    return [{
      trigger: EventTime.take_damage,
      source:  "player",
      target,
      amount:  -(entity.entity.base_hp - entity.entity.remaining_hp),
      log:     `Mend restores ${entity.description} to full health.`,
    } as AmountEvent];
  },
  icon:   "ra-health",
  color:  "#40a060",
  rarity: "uncommon",
  flavor: "The wound remembers it never existed.",
};

/** Give a friendly creature +3 permanent defense. */
export const IronSkinTemplate: CastingTemplate = {
  kind: "casting",
  name:   "Iron Skin",
  cost:   2,
  onPlay(state, _caster, target): GameEvent[] {
    if (target === undefined) return [];
    const entity = state.getEntity(target);
    if (!entity) return [];
    entity.entity.defense += 3;
    state.log.push(`Iron Skin grants ${entity.description} +3 defense (now ${entity.entity.defense}).`);
    return [];
  },
  icon:   "ra-shield-2",
  color:  "#507090",
  rarity: "common",
  flavor: "Flesh becomes iron. Iron becomes legend.",
};

export const castings: CastingTemplate[] = [
  LightningBoltTemplate,
  HasteTemplate,
  MendTemplate,
  IronSkinTemplate,
];
