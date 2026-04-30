<svelte:head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rpg-awesome@0.2.0/css/rpg-awesome.min.css" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,400&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte';

  const cardKindVariants: CardType[] = ["creature", "construction", "casting"];

  const STARTING_MANA = 4;

  type EntityId   = number;
  type LogMessage = string | null;
  type EventSource = EntityId | PlayerId | "player" | "system";
  type EventTarget = EntityId | "none" | "player_A" | "player_B" | "all";

  type PlayCardResult = "ok" | "not_enough_mana" | "invalid_coords" | "invalid_target";

  type CastingTargeting =
    | { kind: "none" }
    | { kind: "target"; isLegal: (state: GameState, caster: PlayerId, candidate: Entity) => boolean };
  type PlayerId       = "A" | "B";
  type CardType = "creature" | "construction" | "casting";

  type Attribute = "undead" | "human" | "magic" | "has_potion" | "beast";

  interface Coords {
    x: number;
    y: number;
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  const NUM_ROWS  = 5;
  const NUM_COLS  = 5;
  const NUM_CELLS = NUM_ROWS * NUM_COLS;

  function playRowX(p: "A" | "B"): number {
    return p === "A" ? NUM_ROWS - 1 : 0;
  }

  function coords_to_index(c: Coords): number {
    return c.x * NUM_ROWS + c.y;
  }

  function index_to_coords(i: number): Coords {
    return { x: Math.floor(i / NUM_ROWS), y: i % NUM_ROWS };
  }

  function shuffle<T>(arr: T[]): T[] {
    // Fisher–Yates. The previous loop used indices beyond arr.length which
    // could swap `undefined` into the array.
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const seed = Math.floor(Date.now()) % (a.length - 1);
      [a[i], a[seed]] = [a[seed], a[i]];
    }
    return a;
  }

  // ============================================================
  // EVENT TRIGGERS
  // ============================================================

  const EventTime = {
    deal_damage:                "on_deal_damage",
    take_damage:                "on_take_damage",
    played:                     "on_played",
    killed:                     "on_killed",
    moved:                      "on_moved",
    spawned:                    "on_spawned",
    turn_start:                 "on_turn_start",
    turn_end:                   "on_turn_end",
    cast:                       "on_cast",
    change_castle_control:      "on_change_castle_control",
  } as const;

  type EventTime = typeof EventTime[keyof typeof EventTime];

  const EventMoment = {
    before: "before",
    after:  "after",
  } as const;

  type EventMoment = typeof EventMoment[keyof typeof EventMoment];

  // ============================================================
  // EVENTS
  // ============================================================

  type BaseFields = {
    source:     EventSource;
    target?:    EventTarget;
    log?:       LogMessage;
    _resolved?: boolean;
  };

  type AmountEvent = BaseFields & {
    trigger: typeof EventTime.take_damage | typeof EventTime.deal_damage;
    target: EventTarget;
    amount: number;
  };

  type MoveEvent = BaseFields & {
    trigger: typeof EventTime.moved;
    from: Coords;
    to:   Coords;
  };

  type CastEvent = BaseFields & {
    trigger: typeof EventTime.cast;
    caster: PlayerId;
    cast_kind: CardType;
  };

  type CastleEvent = BaseFields & {
    trigger: typeof EventTime.change_castle_control;
    new_controller: PlayerId;
    old_controller: PlayerId | null;
  };

  type TurnEvent = BaseFields & {
    trigger: typeof EventTime.turn_start | typeof EventTime.turn_end;
    player: PlayerId;
  };

  type SimpleEvent = BaseFields & {
    trigger: typeof EventTime.played | typeof EventTime.killed;
    target: EventTarget;
  };

  type SpawnEvent = BaseFields & {
    trigger:    typeof EventTime.spawned;
    target:     EntityId;
    entity:     Entity;
    where:      Coords;
    controller: PlayerId;
  };

  type GameEvent = AmountEvent | MoveEvent | CastEvent | CastleEvent | TurnEvent | SimpleEvent | SpawnEvent;

  // ============================================================
  // ABILITIES
  // ============================================================

  interface Ability {
    trigger:     EventTime;
    name:        string;
    description: string;

    /** MODIFY phase — mutate the event before it resolves. */
    modify?: (state: GameState, event: GameEvent, selfId: EntityId) => void;

    /** REACT phase — fire after the event resolves; return follow-up events. */
    react?:  (state: GameState, event: GameEvent, selfId: EntityId) => GameEvent[];
  }

  // ============================================================
  // PASSIVES (player-level pact effects)
  // ============================================================

  type PassiveKind = "buff" | "curse";

  interface Passive {
    id:          string;
    name:        string;
    description: string;
    icon:        string;
    color:       string;
    kind:        PassiveKind;
    trigger:     EventTime;
    mutexWith?:  string[];
    modify?:     (state: GameState, event: GameEvent, owner: PlayerId) => void;
    react?:      (state: GameState, event: GameEvent, owner: PlayerId) => GameEvent[];
  }

  interface Pact {
    id:    string;
    buff:  Passive | null;
    curse: Passive | null;
  }

  // ============================================================
  // TEMPLATES & ENTITIES
  // ============================================================

  interface Playable {
    cost: number;
    kind: CardType;
    name: string;
  }

  interface CreatureTemplate extends Playable {
    kind:        "creature";
    name:        string;
    cost:        number;
    attack:      number;
    defense:     number;
    hp:          number;
    energy:      number;
    abilities:   Ability[];
    attributes?: Attribute[];
    icon?:       string;
    color?:      string;
    rarity?:     "common" | "uncommon" | "rare" | "legendary";
    flavor?:     string;
  }

  interface ConstructionTemplate extends Playable {
    kind:        "construction";
    name:        string;
    cost:        number;
    defense:     number;
    hp:          number;
    abilities:   Ability[];
    attributes?: Attribute[];
    icon?:       string;
    color?:      string;
    rarity?:     "common" | "uncommon" | "rare" | "legendary";
    flavor?:     string;
  }

  class Creature {
    kind: CardType = "creature";
    name:             string;
    attack:           number = $state(0);
    defense:          number = $state(0);
    base_hp:          number = $state(0);
    remaining_hp:     number = $state(0);
    base_energy:      number = $state(0);
    remaining_energy: number = $state(0);
    abilities:        Ability[];
    attributes:       Attribute[] = $state([]);

    constructor (
      name: string,
      attack: number,
      defense: number,
      hp: number,
      energy: number,
      abilities: Ability[],
      attributes: Attribute[],
    ) {
      this.name             = name;
      this.attack           = attack;
      this.defense          = defense;
      this.base_hp          = hp;
      this.remaining_hp     = hp;
      this.base_energy      = energy;
      this.remaining_energy = energy;
      this.abilities        = abilities;
      this.attributes       = attributes;
    }

    static from_template(t: CreatureTemplate): Creature {
      return new Creature(t.name, t.attack, t.defense, t.hp, t.energy, t.abilities, [...(t.attributes ?? [])]);
    }
  }

  class Construction {
    kind: CardType = "construction";
    name:         string;
    defense:      number = $state(0);
    base_hp:      number = $state(0);
    remaining_hp: number = $state(0);
    abilities:    Ability[];
    attributes:   Attribute[] = $state([]);

    constructor(name: string, defense: number, hp: number, abilities: Ability[], attributes: Attribute[]) {
      this.name         = name;
      this.defense      = defense;
      this.base_hp      = hp;
      this.remaining_hp = hp;
      this.abilities    = abilities;
      this.attributes   = attributes;
    }

    static from_template(t: ConstructionTemplate): Construction {
      return new Construction(t.name, t.defense, t.hp, t.abilities, [...(t.attributes ?? [])]);
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

  class PlayerState {
    id:          PlayerId;
    mana:        number = $state(0);
    castleHolds: number = $state(0);

    constructor(id: PlayerId, mana: number, castleHolds: number) {
      this.id          = id;
      this.mana        = mana;
      this.castleHolds = castleHolds;
    }
  }

  class Deck {
    cards: Record<CardType, (Playable | null)[]>;
    i_vals: Record<CardType, number> = {
      casting: 0,
      creature: 0,
      construction: 0,
    };

    constructor(
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
      newDeck.i_vals = { ...this.i_vals };
      return newDeck;
    }

    draw(kind: CardType): Playable {
      let i = this.i_vals[kind];
      this.i_vals[kind]++;
      let mod = this.cards[kind].length;
      return this.cards[kind][i % mod] as Playable;
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

  const HAND_SIZES: Record<CardType, number> = { creature: 4, construction: 3, casting: 2 };
  const REROLL_COST = 1;

  class GameState {
    next_id: number = 0;
    turnNumber:      number = $state(1);
    grid:            (Entity | null)[] = $state(Array(NUM_CELLS).fill(null));
    players:         Record<PlayerId, PlayerState> = $state({} as Record<PlayerId, PlayerState>);
    decks:           Record<PlayerId, Deck> = $state({} as Record<PlayerId, Deck>);
    reserves:        Record<PlayerId, Deck> = $state({} as Record<PlayerId, Deck>);
    turn:            PlayerId = $state("A");
    log:             string[] = $state([]);
    pacts:           Record<PlayerId, Pact | null> = $state({ A: null, B: null });

    constructor(shuffledDeck: Deck) {
      this.grid = Array(NUM_CELLS).fill(null);

      this.decks = {
        A: shuffledDeck.clone(),
        B: shuffledDeck.clone(),
      };

      this.reserves = {
        A: new Deck([], [], []),
        B: new Deck([], [], []),
      };

      for (let j = 0; j < 2; j++) {
        let p: PlayerId = j == 0 ? 'A' : 'B';
        for (const v of cardKindVariants) {
          for (let i = 0; i < HAND_SIZES[v]; i++) {
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

    draw(idx: number, kind: CardType) {
      this.reserves[this.turn].cards[kind][idx] = this.decks[this.turn].draw(kind);
    }

    reroll(idx: number, kind: CardType): boolean {
      const p = this.players[this.turn];
      if (p.mana < REROLL_COST) return false;
      const card = this.reserves[this.turn].cards[kind][idx];
      if (!card) return false;
      p.mana -= REROLL_COST;
      this.reserves[this.turn].cards[kind][idx] = this.decks[this.turn].draw(kind);
      this.log.push(`${this.turn} rerolls a ${kind} slot for ${REROLL_COST} mana.`);
      return true;
    }

    play(cardIndex: number, where: Coords, kind: CardType): PlayCardResult {
      const card = this.reserves[this.turn].cards[kind][cardIndex];
      if (!card) return "invalid_coords";

      const n = coords_to_index(where);
      if (n < 0 || n >= NUM_CELLS) return "invalid_coords";
      if (card.cost > this.players[this.turn].mana) return "not_enough_mana";
      if (card.kind !== "casting" && where.x !== playRowX(this.turn)) return "invalid_coords";

      const entityAt = this.getEntityAt(where);
      const caster   = this.turn;

      let castTarget: EventTarget | undefined;
      let followups: GameEvent[] = [];

      if (card.kind === "casting") {
        const casting = card as CastingTemplate;
        let resolved: Entity | undefined;
        if (casting.targeting.kind === "target") {
          if (!entityAt || !casting.targeting.isLegal(this, caster, entityAt)) {
            return "invalid_target";
          }
          resolved = entityAt;
          castTarget = entityAt.id;
        }
        this.players[caster].mana -= card.cost;
        followups = casting.onPlay(this, caster, resolved);
        this.reserves[caster].cards[kind][cardIndex] = null;
      } else {
        if (entityAt) return "invalid_coords";
        this.players[caster].mana -= card.cost;
        const spawned = this.spawn(card as (CreatureTemplate | ConstructionTemplate), caster, where, "player");
        castTarget = spawned.id;
        this.reserves[caster].cards[kind][cardIndex] = null;
        followups = [{ trigger: EventTime.played, source: "player", target: spawned.id }];
      }

      this.triggerEvent({
        trigger:   EventTime.cast,
        source:    "player",
        target:    castTarget,
        caster,
        cast_kind: card.kind,
        log:       `${caster} cast ${card.name}.`,
      } as CastEvent);

      for (const ev of followups) this.triggerEvent(ev);
      return "ok";
    }

    canTargetCasting(template: CastingTemplate, where: Coords): boolean {
      if (template.targeting.kind === "none") return true;
      const entity = this.getEntityAt(where);
      if (!entity) return false;
      return template.targeting.isLegal(this, this.turn, entity);
    }

    // ----------------------------------------------------------
    // CORE EVENT ENGINE
    // ----------------------------------------------------------

    private calculateDamage (attack: number, defense: number): number {
      // let baseDamage = Math.max(0, attack - defense);
      // let crits = Math.max(0, attack - baseDamage);
      // return baseDamage + crits * 2;
      // return Math.max(0, attack - defense);
      return attack / Math.max(1, Math.min(defense, 10));
    }

    private triggerEvent(event: GameEvent): void {
      if (event._resolved) { return; }

      // ── 1. MODIFY ─────────────────────────────────────────
      for (const entity of this.allEntities()) {
        for (const ab of entity.entity.abilities) {
          if (ab.trigger === event.trigger && ab.modify) {
            console.log('before: ', event);
            ab.modify(this, event, entity.id);
            console.log('after: ', event);
          }
        }
      }
      for (const owner of ["A", "B"] as PlayerId[]) {
        const pact = this.pacts[owner];
        if (!pact) continue;
        for (const passive of [pact.buff, pact.curse]) {
          if (!passive) continue;
          if (passive.trigger === event.trigger && passive.modify) {
            passive.modify(this, event, owner);
          }
        }
      }

      // ── 2. REACT ──────────────────────────────────────────
      for (const entity of this.allEntities()) {
        for (const ab of entity.entity.abilities) {
          if (ab.trigger === event.trigger && ab.react) {
            let reactions = ab.react(this, event, entity.id);
            for (const r of reactions) {
              this.triggerEvent(r);
            }
          }
        }
      }
      for (const owner of ["A", "B"] as PlayerId[]) {
        const pact = this.pacts[owner];
        if (!pact) continue;
        for (const passive of [pact.buff, pact.curse]) {
          if (!passive) continue;
          if (passive.trigger === event.trigger && passive.react) {
            const reactions = passive.react(this, event, owner);
            for (const r of reactions) this.triggerEvent(r);
          }
        }
      }


      // ── 3. RESOLVE ──────────────────────────────────────────
      const followups: GameEvent[] = [];
      if (event.log) this.emit(event.log);

      switch (event.trigger) {
        case EventTime.take_damage: {
          const e = event as AmountEvent;
          if (typeof e.target === "number") {
            const entity = this.getEntity(e.target);
            if (entity) {
              const src = typeof e.source === "number" ? this.getEntity(e.source) : null;
              const fromClause = src && src.id !== entity.id ? ` from ${src.description}` : "";
              if (e.amount > 0) {
                const prevHp = entity.entity.remaining_hp;
                entity.entity.remaining_hp -= e.amount;
                this.emit(`${entity.description} takes ${e.amount} damage${fromClause} → ${entity.entity.remaining_hp}/${entity.entity.base_hp} hp`);
                // Only enqueue `killed` on the alive→dead transition. Without this
                // guard, a dying entity that is still on the grid (removeEntity runs
                // in the killed RESOLVE, not REACT) can keep receiving damage from
                // reactions (e.g. Sacred → ally → thornAura → back to the dying
                // entity) and re-enqueue killed, causing infinite recursion.
                if (prevHp > 0 && entity.entity.remaining_hp <= 0) {
                  followups.push({
                    trigger: EventTime.killed,
                    source:  e.source,
                    target:  e.target,
                    log:     `${entity.description} was killed.`,
                  });
                }
              } else if (e.amount < 0) {
                const heal = -e.amount;
                entity.entity.remaining_hp = Math.min(entity.entity.base_hp, entity.entity.remaining_hp + heal);
                this.emit(`${entity.description} heals ${heal} → ${entity.entity.remaining_hp}/${entity.entity.base_hp} hp`);
              }
            }
          }
          break;
        }

        case EventTime.killed: {
          if (typeof event.target === "number") {
            this.removeEntity(event.target);
          }
          break;
        }

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

        case EventTime.change_castle_control: {
          const e = event as CastleEvent;
          this.emit(`Castle control: ${e.old_controller ?? "none"} → ${e.new_controller}`);
          break;
        }

        case EventTime.deal_damage: {
          const e = event as AmountEvent;
          const attacker = typeof e.source === "number" ? this.getEntity(e.source) : null;
          const defender = typeof e.target === "number" ? this.getEntity(e.target) : null;
          if (!attacker || !defender) break;
          if (!(attacker.entity instanceof Creature)) break;
          if (attacker.entity.remaining_energy <= 0) break;
          attacker.entity.remaining_energy--;
          const atkDmg = this.calculateDamage(attacker.entity.attack, defender.entity.defense);
          this.emit(`${attacker.description} attacks ${defender.description} for ${atkDmg}.`);
          followups.push({
            trigger: EventTime.take_damage,
            source:  e.source,
            target:  e.target,
            amount:  atkDmg,
          } as AmountEvent);
          break;
        }

        case EventTime.spawned: {
          const e = event as SpawnEvent;
          this.emit(`${e.controller} summons ${e.entity.description} at (${e.where.x},${e.where.y}).`);
          break;
        }

        case EventTime.cast:
        case EventTime.turn_start:
        case EventTime.turn_end:
        case EventTime.played:
          break;
      }

      for (const f of followups) {
        this.triggerEvent(f);
      }

      event._resolved = true;
      return;
    }

    // ----------------------------------------------------------
    // PUBLIC ACTIONS
    // ----------------------------------------------------------

    spawn(
      template: CreatureTemplate | ConstructionTemplate,
      controller: PlayerId,
      where: Coords,
      source: EventSource = "system",
    ): Entity {
      const isCreature = "attack" in template;
      const entity: Entity = {
        id:          this.next_id++,
        controller,
        description: template.name,
        entity:      isCreature
          ? Creature.from_template(template as CreatureTemplate)
          : Construction.from_template(template as ConstructionTemplate),
      };
      // Place first so MODIFY/REACT handlers (including the spawned entity's own
      // abilities) see it on the grid. RESOLVE just logs.
      this.placeEntity(entity, where);
      this.triggerEvent({
        trigger:    EventTime.spawned,
        source,
        target:     entity.id,
        entity,
        where,
        controller,
      } as SpawnEvent);
      return entity;
    }

    fireTurnStart(player: PlayerId): void {
      this.triggerEvent({
        trigger: EventTime.turn_start,
        source:  "system",
        player,
      } as TurnEvent);
    }

    attack(attackerId: EntityId, defenderId: EntityId): void {
      const attacker = this.getEntity(attackerId);
      if (!attacker) return;
      if (!(attacker.entity instanceof Creature)) return;
      if (attacker.entity.remaining_energy <= 0) return;
      this.triggerEvent({
        trigger: EventTime.deal_damage,
        source:  attackerId,
        target:  defenderId,
        amount:  0,
      } as AmountEvent);
    }

    move(entityId: EntityId, to: Coords): void {
      const entity = this.getEntity(entityId);
      if (!entity) return;
      if (entity.entity instanceof Creature) {
        if (entity.entity.remaining_energy <= 0) return;
        entity.entity.remaining_energy--;
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

    nextTurn(): void {
      const current  = this.turn;
      const opponent = this.opponent(current);

      this.triggerEvent({
        trigger: EventTime.turn_end,
        source:  "system",
        target:  "none",
        player:  current,
      } as TurnEvent);

      this.turn = opponent;
      this.turnNumber++;

      this.players[opponent].mana += 2;

      // Refill any slots the incoming player spent on their previous turn —
      // "spent" only locks the slot for the rest of that turn, not the game.
      for (const k of cardKindVariants) {
        const slots = this.reserves[opponent].cards[k];
        for (let i = 0; i < slots.length; i++) {
          if (slots[i] == null) {
            slots[i] = this.decks[opponent].draw(k);
          }
        }
      }

      for (const entity of this.allEntities()) {
        if (entity.controller === this.turn && entity.entity instanceof Creature) {
          entity.entity.remaining_energy = entity.entity.base_energy;
        }
      }

      this.triggerEvent({
        trigger: EventTime.turn_start,
        source:  "system",
        target:  "none",
        player:  opponent,
      } as TurnEvent);

      this.emit(`--- Turn ${this.turnNumber}: Player ${this.turn} (${this.players[this.turn].mana} mana) ---`);
    }

    private emit(msg: string): void {
      this.log.push(msg);
    }
  }

  // ============================================================
  // ABILITY HELPERS
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

  const directionPriority: Record<Direction, number> = { north: 0, east: 1, west: 2, south: 3 };

  function findNearestCoord(origin: Coords, candidates: Coords[]): Coords | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((best, curr) => {
      const bestDist = Math.abs(best.x - origin.x) + Math.abs(best.y - origin.y);
      const currDist = Math.abs(curr.x - origin.x) + Math.abs(curr.y - origin.y);
      if (currDist < bestDist) return curr;
      if (currDist > bestDist) return best;
      const bestDir = getDirection(origin, best);
      const currDir = getDirection(origin, curr);
      const bestScore = bestDir !== null ? directionPriority[bestDir] : Number.MAX_SAFE_INTEGER;
      const currScore = currDir !== null ? directionPriority[currDir] : Number.MAX_SAFE_INTEGER;
      return currScore < bestScore ? curr : best;
    });
  }

  function adjacentCoords(c: Coords): Coords[] {
    return [
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y },
      { x: c.x, y: c.y - 1 },
      { x: c.x, y: c.y + 1 },
    ].filter(p => p.x >= 0 && p.x < NUM_ROWS && p.y >= 0 && p.y < NUM_COLS);
  }

  function adjacentEntities(state: GameState, c: Coords): Entity[] {
    return adjacentCoords(c)
      .map(p => state.getEntityAt(p))
      .filter((e): e is Entity => e !== null);
  }

  // ============================================================
  // ABILITIES
  // ============================================================

  const healingAura: Ability = {
    name:        "Healing Aura",
    description: "At the start of your turn, heal 2 hp to each of your other creatures.",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const owner = state.getEntity(selfId)?.controller;
      if (!owner) return [];
      if ((event as TurnEvent).player !== owner) return [];
      return state.allEntities()
        .filter(e => e.controller === owner && e.id !== selfId && e.entity instanceof Creature)
        .map(e => ({
          trigger: EventTime.take_damage,
          source:  selfId,
          target:  e.id,
          amount:  -2,
          log:     `Healing Aura restores 2 hp to ${e.description}.`,
        } as AmountEvent));
    },
  };

  const UndeadMaster: Ability = {
    name:        "Undead Master",
    description: "When one of your creatures kills a non-undead creature, raise it as a Zombie under your control.",
    trigger:     EventTime.killed,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      if (!self) return [];
      const owner = self.controller;

      if (typeof event.target !== "number") return [];
      if (event.target === selfId)          return [];
      const victim = state.getEntity(event.target);
      if (!victim)                              return [];
      if (!(victim.entity instanceof Creature)) return [];
      if (victim.entity.attributes.includes("undead")) return [];

      if (typeof event.source !== "number") return [];
      const killer = state.getEntity(event.source);
      if (!killer || killer.controller !== owner) return [];

      const coords = state.findCoords(event.target);
      if (!coords) return [];

      state.removeEntity(event.target);
      const zombie = state.spawn(Zombie, owner, coords, selfId);
      state.log.push(`Undead Master raises ${victim.description} as ${zombie.description} under ${owner}'s control.`);
      return [];
    },
  };

  const damageShield: Ability = {
    name:        "Damage Shield",
    description: "Reduce incoming damage by 1 (minimum 0).",
    trigger:     EventTime.take_damage,
    modify(state, event, selfId): void {
      const e = event as AmountEvent;
      if (e.target !== selfId) return;
      if (e.amount <= 0)       return;
      e.amount = Math.max(0, e.amount - 1);
      state.log.push(`Damage Shield absorbs 1 damage on entity ${selfId}.`);
    },
  };

  const Smite: Ability = {
    name:        "Smite",
    description: "Deal double damage to undead creatures.",
    trigger:     EventTime.deal_damage,
    modify(state, event, _selfId): void {
      const e = event as AmountEvent;
      if (typeof e.target !== "number") return;
      const target = state.getEntity(e.target);
      if (!target) return;
      if (target.entity instanceof Creature && target.entity.attributes.includes("undead")) {
        e.amount *= 2;
        state.log.push(`Smite doubles damage against ${target.description}.`);
      }
    },
  };

  const deathCurse: Ability = {
    name:        "Death Curse",
    description: "When killed, drag the killer down with you.",
    trigger:     EventTime.killed,
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
      } as SimpleEvent];
    },
  };

  const gainManaOnDeath: Ability = {
    name:        "Soul Harvest",
    description: "When this creature dies, its controller gains 2 mana.",
    trigger:     EventTime.killed,
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

  const thornAura: Ability = {
    name:        "Thorn Aura",
    description: "When hit, deal 1 damage back to the attacker.",
    trigger:     EventTime.take_damage,
    react(state, event, selfId): GameEvent[] {
      const e = event as AmountEvent;
      if (e.target !== selfId) return [];
      if (e.amount <= 0)       return [];
      if (typeof e.source !== "number") return [];
      const attacker = state.getEntity(e.source);
      if (!attacker) return [];
      return [{
        trigger: EventTime.take_damage,
        source:  selfId,
        target:  e.source,
        amount:  1,
        log:     `Thorn Aura pricks ${attacker.description} for 1.`,
      } as AmountEvent];
    },
  };

  const warCry: Ability = {
    name:        "War Cry",
    description: "Each time you play a creature, this creature gains +1 attack.",
    trigger:     EventTime.cast,
    react(state, event, selfId): GameEvent[] {
      const self  = state.getEntity(selfId);
      const caste = event as CastEvent;
      if (!self || caste.caster !== self.controller) return [];
      if (caste.cast_kind !== "creature")            return [];
      if (event.target === selfId)                   return [];
      if (!(self.entity instanceof Creature))        return [];
      self.entity.attack += 1;
      state.log.push(`War Cry: ${self.description}'s attack rises to ${self.entity.attack}.`);
      return [];
    },
  };

  const RegeneratingHeads: Ability = {
    name:        "Regenerating Heads",
    description: "Each time this creature is hit, it grows: +1 energy, +1 attack, +2 hp.",
    trigger:     EventTime.take_damage,
    react(state, event, selfId): GameEvent[] {
      const e = event as AmountEvent;
      if (e.target !== selfId) return [];
      if (e.amount <= 0) return [];
      const self = state.getEntity(selfId);
      if (!self || !(self.entity instanceof Creature)) return [];
      self.entity.base_energy      += 1;
      self.entity.remaining_energy += 1;
      self.entity.attack           += 1;
      self.entity.base_hp          += 2;
      self.entity.remaining_hp     += 2;
      state.log.push(`${self.description} regrows — now ${self.entity.attack} atk / ${self.entity.remaining_hp} hp / ${self.entity.base_energy} energy.`);
      return [];
    },
  };

  const coveringFire: Ability = {
    name:        "Covering Fire",
    description: "At the start of your turn, snipe the nearest enemy entity for 1 damage.",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      if ((event as TurnEvent).player !== self.controller) return [];
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
      return [{
        trigger: EventTime.take_damage,
        source:  selfId,
        target:  target.id,
        amount:  1,
        log:     `Covering Fire snipes ${target.description} for 1.`,
      } as AmountEvent];
    },
  };

  const manaSpring: Ability = {
    name:        "Mana Spring",
    description: "At the start of your turn, grant 1 mana to your player — plus 1 for each adjacent allied creature that also has Mana Spring.",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      const owner = self.controller;
      if ((event as TurnEvent).player !== owner) return [];
      let bonus = 0;
      for (const neighbour of adjacentEntities(state, origin)) {
        if (neighbour.controller !== owner) continue;
        if (neighbour.entity.abilities.some(a => a.name === "Mana Spring")) bonus++;
      }
      const total = 1 + bonus;
      state.players[owner].mana += total;
      state.log.push(`Mana Spring (${self.description}) grants ${total} mana to ${owner} (now ${state.players[owner].mana}).`);
      return [];
    },
  };

  const thinksFireIsAToy: Ability = {
    name:        "Plays With Fire",
    description: "When attacking, deal equal damage to self",
    trigger:     EventTime.deal_damage,
    react(state, event, selfId): GameEvent[] {
      const e = event as AmountEvent;
      if (e.source !== selfId) return [];
      if (typeof e.target !== "number" || e.target === selfId) return [];
      if ((e as any)._splash) return [];
      if (e.amount <= 0) return [];
      const victim = state.getEntity(e.target);
      if (!victim) return [];
      const victimCoords = state.findCoords(e.target);
      if (!victimCoords) return [];
      return [{
          trigger: EventTime.take_damage,
          source:  selfId,
          target:  selfId,
          amount:  e.amount,
          log:     `the pyromaniac burned himself for ${e.amount}.`,
          _splash: true,
        } as AmountEvent];
    },
  };

  const Key: Ability = {
    name:        "Key of the Castle",
    description: "The first time this creature enters the castle, it gains +10 to attack, defense, and hp.",
    trigger:     EventTime.moved,
    react(state, event, selfId): GameEvent[] {
      const e = event as MoveEvent;
      if (typeof e.source !== "number" || e.source !== selfId) return [];
      const castle = index_to_coords(CASTLE_IDX);
      if (e.to.x !== castle.x || e.to.y !== castle.y) return [];
      const self = state.getEntity(selfId);
      if (!self || !(self.entity instanceof Creature)) return [];
      if (self.entity.attributes.includes("entered_castle" as Attribute)) return [];
      self.entity.attributes.push("key_used" as Attribute);
      self.entity.attack       += 10;
      self.entity.defense      += 10;
      self.entity.base_hp      += 10;
      self.entity.remaining_hp += 10;
      state.log.push(`Key of the Castle: ${self.description} ascends — +10 atk/def/hp.`);
      return [];
    },
  };

  const Sacred: Ability = {
    name:        "Sacred",
    description: "When killed, each allied creature takes 1 damage in grief.",
    trigger:     EventTime.killed,
    react(state, event, selfId): GameEvent[] {
      if (event.target !== selfId) return [];
      const self = state.getEntity(selfId)
        ?? state.allEntities().find(x => x.id === selfId);
      if (!self) return [];
      const owner = self.controller;
      return state.allEntities()
        .filter(a => a.controller === owner && a.id !== selfId && a.entity instanceof Creature)
        .map(a => ({
          trigger: EventTime.take_damage,
          source:  selfId,
          target:  a.id,
          amount:  1,
          log:     `Sacred: the death of ${self.description} grieves ${a.description}.`,
        } as AmountEvent));
    },
  };

  const Reflection: Ability = {
    name:        "Reflection",
    description: "Uses the attacker's own attack when striking and the attacker's defense when being hit.",
    trigger:     EventTime.take_damage,
    modify(state, event, selfId): void {
      const e = event as AmountEvent;
      if (typeof e.source !== "number") return;
      const self = state.getEntity(selfId);
      const attacker = state.getEntity(e.source);
      if (!self || !attacker) return;
      if (!(self.entity instanceof Creature) || !(attacker.entity instanceof Creature)) return;
      if (e.target === selfId) {
        // Being hit: swap defense — recompute with attacker's own defense.
        const delta = self.entity.defense - attacker.entity.defense;
        e.amount = Math.max(0, e.amount + delta);
        state.log.push(`Reflection recomputes incoming damage using ${attacker.description}'s defense (${e.amount}).`);
      } else if (e.source === selfId && typeof e.target === "number") {
        const victim = state.getEntity(e.target);
        if (!victim || !(victim.entity instanceof Creature)) return;
        // Attacking: use victim's attack as the strike power.
        const recomputed = Math.max(0, victim.entity.attack - victim.entity.defense);
        e.amount = recomputed;
        state.log.push(`Reflection mirrors ${victim.description}'s attack (${e.amount}).`);
      }
    },
  };

  const ForbiddenMove: Ability = {
    name:        "Cannot Enter the Castle",
    description: "The forbidden on cannot enter the castle",
    trigger:     EventTime.moved,
    modify(state, event, selfId): void {
      const e = event as MoveEvent;
      if (e.source !== selfId) return;
      if (coords_to_index(e.to) === CASTLE_IDX_CONST) {
        e.to = e.from;
        state.log.push("The Forbidden One is forbidden from entering the castle.");
      }
    },
  };

  const ForbiddenAttack: Ability = {
    name:        "Cannot Attack into the Castle",
    description: "The forbidden on cannot attack into the castle",
    trigger:     EventTime.deal_damage,
    modify(state, event, selfId): void {
      const e = event as AmountEvent;
      if (e.source !== selfId) return;
      if (typeof e.target !== "number") return;
      const tgtCoords = state.findCoords(e.target);
      if (!tgtCoords) return;
      if (coords_to_index(tgtCoords) !== CASTLE_IDX_CONST) return;
      e.amount = 0;
      state.log.push("The Forbidden One is forbidden from attacking into the castle.");
    },
  };

  const BloodSucker: Ability = {
    name:        "Blood Sucker",
    description: "When attacking a creature, drain 1 energy from it. If that reduces it to 0 energy, kill it and gain +1 attack.",
    trigger:     EventTime.deal_damage,
    react(state, event, selfId): GameEvent[] {
      const e = event as AmountEvent;
      if (e.source !== selfId) return [];
      if (typeof e.target !== "number") return [];
      const self = state.getEntity(selfId);
      const victim = state.getEntity(e.target);
      if (!self || !victim) return [];
      if (!(self.entity instanceof Creature))   return [];
      if (!(victim.entity instanceof Creature)) return [];
      victim.entity.remaining_energy = Math.max(0, victim.entity.remaining_energy - 1);
      state.log.push(`Blood Sucker drains 1 energy from ${victim.description}.`);
      if (victim.entity.remaining_energy <= 0) {
        self.entity.attack += 1;
        state.log.push(`${self.description} feasts — +1 attack.`);
        return [{
          trigger: EventTime.killed,
          source:  selfId,
          target:  e.target,
          log:     `${victim.description} is drained to death.`,
        } as SimpleEvent];
      }
      return [];
    },
  };

  const Fixing: Ability = {
    name:        "Tinker",
    description: "At the start of your turn, heal adjacent allied constructions for 2 hp.",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      if ((event as TurnEvent).player !== self.controller) return [];
      return adjacentEntities(state, origin)
        .filter(n => n.controller === self.controller && n.entity instanceof Construction)
        .map(n => ({
          trigger: EventTime.take_damage,
          source:  selfId,
          target:  n.id,
          amount:  -2,
          log:     `Tinker patches up ${n.description}.`,
        } as AmountEvent));
    },
  };

  const Leadership: Ability = {
    name:        "Leadership",
    description: "Adjacent allied creatures take 1 less damage.",
    trigger:     EventTime.take_damage,
    modify(state, event, selfId): void {
      const e = event as AmountEvent;
      if (typeof e.target !== "number") return;
      if (e.amount <= 0) return;
      const self = state.getEntity(selfId);
      const target = state.getEntity(e.target);
      const origin = state.findCoords(selfId);
      if (!self || !target || !origin) return;
      if (target.controller !== self.controller) return;
      if (target.id === selfId) return;
      const tcoords = state.findCoords(target.id);
      if (!tcoords) return;
      const adj = adjacentCoords(origin);
      if (!adj.some(c => c.x === tcoords.x && c.y === tcoords.y)) return;
      e.amount = Math.max(0, e.amount - 1);
      state.log.push(`Leadership shields ${target.description} for 1.`);
    },
  };

  const GivePotion: Ability = {
    name:        "Gives Out Sus Potions",
    description: "At the start of your turn, grant +3 attack and +3 defense to adjacent allied creatures (once each).",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      if ((event as TurnEvent).player !== self.controller) return [];
      for (const neighbour of adjacentEntities(state, origin)) {
        if (neighbour.controller !== self.controller) continue;
        if (!(neighbour.entity instanceof Creature)) continue;
        if (neighbour.entity.attributes.includes("has_potion")) continue;
        neighbour.entity.attack  += 3;
        neighbour.entity.defense += 3;
        state.log.push(`Give Potion: ${neighbour.description} gains +3 atk/+3 def.`);
      }
      return [];
    },
  };

  const TakePotion: Ability = {
    name:        "Potions are no longer available when he dies",
    description: "When the potion dealer dies, every creature that got a potion from him gets -4 defense and -4 attack",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      if ((event as TurnEvent).player !== self.controller) return [];
      for (const e of state.allEntities()) {
        if (e.controller !== self.controller) continue;
        if (!(e.entity instanceof Creature)) continue;
        if (!e.entity.attributes.includes("has_potion")) continue;
        e.entity.attack  -= 4;
        e.entity.defense -= 4;
        e.entity.attack = Math.max(0, e.entity.attack);
        e.entity.defense = Math.max(0, e.entity.defense);
        state.log.push(`The absense of the potions has taken 4 attack and defense from`);
      }
      return [];
    },
  }

  const PowerCreep: Ability = {
    name:        "Power Creep",
    description: "At the start of the turn, deal 2 damage to each adjacent creature and gain attack equal to the damage dealt.",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      if ((event as TurnEvent).player !== state.turn) { return []; }
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      if (!(self.entity instanceof Creature)) return [];
      const neighbours = adjacentEntities(state, origin).filter(n => n.entity instanceof Creature);
      const gained = neighbours.length * 2;
      self.entity.attack += gained;
      if (gained > 0) state.log.push(`Power Creep: ${self.description} gains ${gained} attack.`);
      return neighbours.map(n => ({
        trigger: EventTime.take_damage,
        source:  selfId,
        target:  n.id,
        amount:  2,
        log:     `Power Creep scorches ${n.description} for 2.`,
      } as AmountEvent));
    },
  };

  const SelfReplicate: Ability = {
    name:        "Self-Replicate",
    description: "At the start of your turn, spawn a copy of itself in an adjacent empty cell.",
    trigger:     EventTime.turn_start,
    react(state, event, selfId): GameEvent[] {
      const self = state.getEntity(selfId);
      const origin = state.findCoords(selfId);
      if (!self || !origin) return [];
      if ((event as TurnEvent).player !== self.controller) return [];
      if (!(self.entity instanceof Creature)) return [];
      const empty = adjacentCoords(origin).filter(p => !state.getEntityAt(p));
      if (empty.length === 0) return [];
      const spot = empty[Math.floor(Math.random() * empty.length)];
      const tpl: CreatureTemplate = {
        kind: "creature",
        name: self.entity.name,
        cost: 0,
        attack:    self.entity.attack,
        defense:   self.entity.defense,
        hp:        self.entity.base_hp,
        energy:    self.entity.base_energy,
        abilities: self.entity.abilities,
        attributes: [...self.entity.attributes],
      };
      state.spawn(tpl, self.controller, spot, selfId);
      state.log.push(`Self-Replicate: ${self.description} spawns a copy at (${spot.x},${spot.y}).`);
      return [];
    },
  };

  const Detonate: Ability = {
    name:        "Detonate",
    description: "When destroyed, demolish all adjacent constructions and deal 5 damage to adjacent creatures.",
    trigger:     EventTime.killed,
    react(state, event, selfId): GameEvent[] {
      if (event.target !== selfId) return [];
      const origin = state.findCoords(selfId);
      if (!origin) return [];
      const neighbours = adjacentEntities(state, origin);
      const events: GameEvent[] = [];
      for (const n of neighbours) {
        if (n.entity instanceof Construction) {
          events.push({
            trigger: EventTime.killed,
            source:  selfId,
            target:  n.id,
            log:     `Detonate levels ${n.description}.`,
          } as SimpleEvent);
        } else if (n.entity instanceof Creature) {
          events.push({
            trigger: EventTime.take_damage,
            source:  selfId,
            target:  n.id,
            amount:  5,
            log:     `Detonate blasts ${n.description} for 5.`,
          } as AmountEvent);
        }
      }
      return events;
    },
  };

  const MagicEducation: Ability = {
    name:        "Magic Education",
    description: "When an allied creature with the magic attribute is played, grant it +1 attack.",
    trigger:     EventTime.played,
    react(state, event, selfId): GameEvent[] {
      const tid = event.target;
      if (typeof tid !== "number" || tid === selfId) return [];
      const self = state.getEntity(selfId);
      const played = state.getEntity(tid);
      if (!self || !played) return [];
      if (played.controller !== self.controller) return [];
      if (!(played.entity instanceof Creature))  return [];
      if (!played.entity.attributes.includes("magic")) return [];
      played.entity.attack += 1;
      state.log.push(`Magic Education: ${played.description} gains +1 attack.`);
      return [];
    },
  };

  // ============================================================
  // PASSIVES — 10 buffs and 10 curses
  // ============================================================

  /** Resolve the controller of any entity-id source/target, if applicable. */
  function controllerOfEventId(state: GameState, id: EventTarget | EventSource): PlayerId | null {
    if (typeof id !== "number") return null;
    return state.getEntity(id)?.controller ?? null;
  }

  function ownedCreatures(state: GameState, owner: PlayerId): Entity[] {
    return state.allEntities().filter(e => e.controller === owner && e.entity instanceof Creature);
  }

  function randomOf<T>(arr: T[]): T | null {
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
  }

  // ── BUFFS ────────────────────────────────────────────────────

  const BuffBountifulHarvest: Passive = {
    id: "bountiful_harvest", kind: "buff",
    name: "Bountiful Harvest",
    description: "Gain +1 mana at the start of each of your turns.",
    icon: "ra-wheat", color: "#d8c050",
    trigger: EventTime.turn_start,
    mutexWith: ["Mana Drought"],
    react(state, event, owner) {
      if ((event as TurnEvent).player !== owner) return [];
      state.players[owner].mana += 1;
      state.log.push(`[Pact] Bountiful Harvest: ${owner} gains 1 mana (now ${state.players[owner].mana}).`);
      return [];
    },
  };

  const BuffHeartySummons: Passive = {
    id: "hearty_summons", kind: "buff",
    name: "Hearty Summons",
    description: "Creatures you play gain +1 hp (base and current).",
    icon: "ra-health", color: "#60c080",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      ent.entity.base_hp     += 1;
      ent.entity.remaining_hp += 1;
      state.log.push(`[Pact] Hearty Summons: ${ent.description} +1 hp.`);
      return [];
    },
  };

  const BuffSharpSteel: Passive = {
    id: "sharp_steel", kind: "buff",
    name: "Sharp Steel",
    description: "Creatures you play gain +1 attack.",
    icon: "ra-plain-dagger", color: "#c08040",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      ent.entity.attack += 1;
      state.log.push(`[Pact] Sharp Steel: ${ent.description} +1 attack.`);
      return [];
    },
  };

  const BuffIronTraining: Passive = {
    id: "iron_training", kind: "buff",
    name: "Iron Training",
    description: "Creatures you play gain +1 defense.",
    icon: "ra-shield", color: "#5080c0",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      ent.entity.defense += 1;
      state.log.push(`[Pact] Iron Training: ${ent.description} +1 defense.`);
      return [];
    },
  };

  const BuffRegicide: Passive = {
    id: "regicide", kind: "buff",
    name: "Regicide",
    description: "When an opposing creature steps onto the castle, kill it.",
    icon: "ra-crown", color: "#c04060",
    trigger: EventTime.moved,
    react(state, event, owner) {
      const e = event as MoveEvent;
      const castleCoords = index_to_coords(CASTLE_IDX_CONST);
      if (e.to.x !== castleCoords.x || e.to.y !== castleCoords.y) return [];
      if (typeof e.source !== "number") return [];
      const mover = state.getEntity(e.source);
      if (!mover || mover.controller === owner) return [];
      const pact = state.pacts[owner];
      if (pact) pact.buff = null;
      return [{
        trigger: EventTime.killed,
        source:  "player",
        target:  e.source,
        log:     `[Pact] Regicide strikes ${mover.description} down upon the castle — the boon fades.`,
      } as SimpleEvent];
    },
  };

  const BuffBloodMoon: Passive = {
    id: "blood_moon", kind: "buff",
    name: "Blood Moon",
    description: "When one of your creatures kills an enemy, it heals 2 hp.",
    icon: "ra-moon-sun", color: "#c03030",
    trigger: EventTime.killed,
    react(state, event, owner) {
      if (typeof event.source !== "number") return [];
      const killer = state.getEntity(event.source);
      if (!killer || killer.controller !== owner) return [];
      if (!(killer.entity instanceof Creature)) return [];
      return [{
        trigger: EventTime.take_damage,
        source:  event.source,
        target:  event.source,
        amount:  -2,
        log:     `[Pact] Blood Moon heals ${killer.description} for 2.`,
      } as AmountEvent];
    },
  };

  const BuffSecondWind: Passive = {
    id: "second_wind", kind: "buff",
    name: "Second Wind",
    description: "At the start of your turn, heal each of your creatures for 1.",
    icon: "ra-wind-hole", color: "#80c0a0",
    trigger: EventTime.turn_start,
    react(state, event, owner) {
      if ((event as TurnEvent).player !== owner) return [];
      return ownedCreatures(state, owner).map(e => ({
        trigger: EventTime.take_damage,
        source:  "player",
        target:  e.id,
        amount:  -1,
        log:     `[Pact] Second Wind refreshes ${e.description}.`,
      } as AmountEvent));
    },
  };

  const BuffWarmonger: Passive = {
    id: "warmonger", kind: "buff",
    name: "Warmonger",
    description: "At the start of your turn, one of your creatures gains +1 energy (beyond its base).",
    icon: "ra-horn-call", color: "#c07040",
    trigger: EventTime.turn_start,
    react(state, event, owner) {
      if ((event as TurnEvent).player !== owner) return [];
      const pick = randomOf(ownedCreatures(state, owner));
      if (!pick) return [];
      (pick.entity as Creature).remaining_energy += 1;
      state.log.push(`[Pact] Warmonger: ${pick.description} surges with extra energy.`);
      return [];
    },
  };

  const BuffRelentless: Passive = {
    id: "relentless", kind: "buff",
    name: "Relentless",
    description: "Damage dealt by your creatures is increased by 1.",
    icon: "ra-sword", color: "#c04040",
    trigger: EventTime.take_damage,
    modify(state, event, owner) {
      const e = event as AmountEvent;
      if (e.amount <= 0) return;
      const src = controllerOfEventId(state, e.source);
      if (src !== owner) return;
      e.amount += 1;
    },
  };

  // ── CURSES ───────────────────────────────────────────────────

  const CurseBrittleBones: Passive = {
    id: "brittle_bones", kind: "curse",
    name: "Brittle Bones",
    description: "Creatures you play have -1 hp (base and current), minimum 1.",
    icon: "ra-broken-bone", color: "#a08060",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      const c = ent.entity;
      const newBase = Math.max(1, c.base_hp - 1);
      c.base_hp      = newBase;
      c.remaining_hp = Math.min(c.remaining_hp, newBase);
      c.remaining_hp = Math.max(1, c.remaining_hp - 1);
      state.log.push(`[Pact] Brittle Bones: ${ent.description} weakens.`);
      return [];
    },
  };

  const CurseManaDrought: Passive = {
    id: "mana_drought", kind: "curse",
    name: "Mana Drought",
    description: "Lose 1 mana at the start of each of your turns (minimum 0).",
    icon: "ra-drop", color: "#6080a0",
    trigger: EventTime.turn_start,
    react(state, event, owner) {
      if ((event as TurnEvent).player !== owner) return [];
      state.players[owner].mana = Math.max(0, state.players[owner].mana - 1);
      state.log.push(`[Pact] Mana Drought: ${owner} loses 1 mana (now ${state.players[owner].mana}).`);
      return [];
    },
  };

  const CurseSlowMagic: Passive = {
    id: "slow_magic", kind: "curse",
    name: "Slow Magic",
    description: "After you finish a casting spell, pay 1 extra mana.",
    icon: "ra-hourglass", color: "#806090",
    trigger: EventTime.cast,
    react(state, event, owner) {
      const ce = event as CastEvent;
      if (ce.caster !== owner || ce.cast_kind !== "casting") return [];
      state.players[owner].mana = Math.max(0, state.players[owner].mana - 1);
      state.log.push(`[Pact] Slow Magic: ${owner} pays 1 extra mana.`);
      return [];
    },
  };

  const CursePacifist: Passive = {
    id: "pacifist", kind: "curse",
    name: "Pacifist",
    description: "Creatures you play have -1 attack (minimum 0).",
    icon: "ra-hand", color: "#8090a0",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      ent.entity.attack = Math.max(0, ent.entity.attack - 1);
      state.log.push(`[Pact] Pacifist: ${ent.description} loses 1 attack.`);
      return [];
    },
  };

  const CurseFragileFaith: Passive = {
    id: "fragile_faith", kind: "curse",
    name: "Fragile Faith",
    description: "Your creatures take 1 extra damage from all sources.",
    icon: "ra-burning-eye", color: "#a04040",
    trigger: EventTime.take_damage,
    modify(state, event, owner) {
      const e = event as AmountEvent;
      if (e.amount <= 0) return;
      const tgt = controllerOfEventId(state, e.target);
      if (tgt !== owner) return;
      e.amount += 1;
    },
  };

  const CurseCowardlyRoots: Passive = {
    id: "cowardly_roots", kind: "curse",
    name: "Cowardly Roots",
    description: "Creatures you play have -1 defense (minimum 0).",
    icon: "ra-tree-branch", color: "#607050",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      ent.entity.defense = Math.max(0, ent.entity.defense - 1);
      state.log.push(`[Pact] Cowardly Roots: ${ent.description} loses 1 defense.`);
      return [];
    },
  };

  const CursePyrrhic: Passive = {
    id: "pyrrhic", kind: "curse",
    name: "Pyrrhic Victory",
    description: "When one of your creatures kills an enemy, it takes 2 damage.",
    icon: "ra-trophy", color: "#a07040",
    trigger: EventTime.killed,
    react(state, event, owner) {
      if (typeof event.source !== "number") return [];
      const killer = state.getEntity(event.source);
      if (!killer || killer.controller !== owner) return [];
      if (!(killer.entity instanceof Creature)) return [];
      return [{
        trigger: EventTime.take_damage,
        source:  "player",
        target:  event.source,
        amount:  2,
        log:     `[Pact] Pyrrhic Victory wounds ${killer.description} for 2.`,
      } as AmountEvent];
    },
  };

  const CurseBleedingWill: Passive = {
    id: "bleeding_will", kind: "curse",
    name: "Bleeding Will",
    description: "At the end of your turn, each of your creatures takes 1 damage.",
    icon: "ra-bleeding-wound", color: "#902030",
    trigger: EventTime.turn_end,
    react(state, event, owner) {
      if ((event as TurnEvent).player !== owner) return [];
      return ownedCreatures(state, owner).map(e => ({
        trigger: EventTime.take_damage,
        source:  "player",
        target:  e.id,
        amount:  1,
        log:     `[Pact] Bleeding Will saps ${e.description}.`,
      } as AmountEvent));
    },
  };

  const CurseWeary: Passive = {
    id: "weary", kind: "curse",
    name: "Weary",
    description: "Creatures you play enter play with 0 energy.",
    icon: "ra-sleepy", color: "#606080",
    trigger: EventTime.played,
    react(state, event, owner) {
      const tid = event.target;
      if (typeof tid !== "number") return [];
      const ent = state.getEntity(tid);
      if (!ent || ent.controller !== owner || !(ent.entity instanceof Creature)) return [];
      ent.entity.remaining_energy = 0;
      state.log.push(`[Pact] Weary: ${ent.description} enters exhausted.`);
      return [];
    },
  };

  const CurseUnstableMagic: Passive = {
    id: "unstable_magic", kind: "curse",
    name: "Unstable Magic",
    description: "After you cast a spell, a random friendly creature takes 1 damage.",
    icon: "ra-fire-symbol", color: "#c06060",
    trigger: EventTime.cast,
    react(state, event, owner) {
      const ce = event as CastEvent;
      if (ce.caster !== owner || ce.cast_kind !== "casting") return [];
      const pick = randomOf(ownedCreatures(state, owner));
      if (!pick) return [];
      return [{
        trigger: EventTime.take_damage,
        source:  "player",
        target:  pick.id,
        amount:  1,
        log:     `[Pact] Unstable Magic scorches ${pick.description} for 1.`,
      } as AmountEvent];
    },
  };

  const CASTLE_IDX_CONST = 12;

  const ALL_BUFFS: Passive[] = [
    BuffBountifulHarvest, BuffHeartySummons, BuffSharpSteel, BuffIronTraining, BuffRegicide,
    BuffBloodMoon, BuffSecondWind, BuffWarmonger, BuffRelentless,
  ];

  const ALL_CURSES: Passive[] = [
    CurseBrittleBones, CurseManaDrought, CurseSlowMagic, CursePacifist, CurseFragileFaith,
    CurseCowardlyRoots, CursePyrrhic, CurseBleedingWill, CurseWeary, CurseUnstableMagic,
  ];

  /** Shuffle + pair buffs with curses and return the first N pacts. */
  function generatePactOffering(count: number): Pact[] {
    const buffs  = shuffle(ALL_BUFFS);
    const curses = shuffle(ALL_CURSES);
    const n = Math.min(count, buffs.length, curses.length);
    const pacts: Pact[] = [];
    for (let i = 0; i < n; i++) {
      pacts.push({ id: `${buffs[i].id}__${curses[i].id}`, buff: buffs[i], curse: curses[i] });
      while (
        pacts[i]?.buff?.mutexWith?.includes(pacts[i]?.curse?.name ?? "") ||
        pacts[i]?.curse?.mutexWith?.includes(pacts[i]?.buff?.name ?? "")
      ) {
        const newBuffs = shuffle(ALL_BUFFS);
        pacts[i].buff = newBuffs[0];
      }
    }
    return pacts;
  }

  // ============================================================
  // CREATURE TEMPLATES
  // ============================================================

  const HP_MULT = 2;

  const CursedWarriorTemplate: CreatureTemplate = {
    kind: "creature",
    name: "Cursed Warrior", cost: 3,
    attack: 4, defense: 1, hp: 5 * HP_MULT, energy: 1,
    abilities: [deathCurse],
    icon: "ra-axe", color: "#c05555", rarity: "rare",
    flavor: "Death follows in its wake.",
  };

  const TheForbiddenOne: CreatureTemplate = {
    kind: "creature",
    name: "The Forbidden On", cost: 2,
    attack: 4, defense: 2, hp: 4 * HP_MULT, energy: 1,
    abilities: [ForbiddenMove, ForbiddenAttack],
    icon: "ra-lighthouse", rarity: "rare",
    flavor: "leads others to what he cannot himself possess",
  }

  const SoulHarvesterTemplate: CreatureTemplate = {
    kind: "creature",
    name: "Soul Harvester", cost: 2,
    attack: 2, defense: 0, hp: 3 * HP_MULT, energy: 1,
    abilities: [gainManaOnDeath],
    icon: "ra-skull", color: "#9060c0", rarity: "uncommon",
    flavor: "It feeds on the moment of passing.",
  };

  const HealerTemplate: CreatureTemplate = {
    kind: "creature",
    name: "Healer", cost: 4,
    attack: 1, defense: 1, hp: 4 * HP_MULT, energy: 1,
    abilities: [healingAura, Smite],
    icon: "ra-angel-wings", color: "#50b080", rarity: "uncommon",
    flavor: "Light pours from every wound it touches.",
  };

  const ShieldBearerTemplate: CreatureTemplate = {
    kind: "creature",
    name: "Shield Bearer", cost: 2,
    attack: 2, defense: 2, hp: 6 * HP_MULT, energy: 1,
    abilities: [damageShield],
    icon: "ra-shield", color: "#4080c0", rarity: "common",
    flavor: "No blade has found its mark. Not yet.",
  };

  const ThornWatcherTemplate: CreatureTemplate = {
    kind: "creature",
    name: "Thorn Watcher", cost: 3,
    attack: 1, defense: 1, hp: 4 * HP_MULT, energy: 1,
    abilities: [thornAura],
    icon: "ra-spiral-shell", color: "#80a040", rarity: "uncommon",
    flavor: "Stand too close and bleed.",
  };

  const WarChieftainTemplate: CreatureTemplate = {
    kind: "creature",
    name: "War Chieftain", cost: 4,
    attack: 3, defense: 1, hp: 4 * HP_MULT, energy: 1,
    abilities: [warCry],
    icon: "ra-viking-head", color: "#c08040", rarity: "rare",
    flavor: "One roar and the whole army surges forward.",
  };

  const RegularDude: CreatureTemplate = {
    kind: "creature",
    name: "Regular Dude", cost: 1,
    attack: 1, defense: 1, hp: 2 * HP_MULT, energy: 2,
    abilities: [],
    icon: "ra-fox", color: "green", rarity: "common",
    flavor: "see creature name",
  }

  const Hydra: CreatureTemplate = {
    kind: "creature",
    name: "Hydra", cost: 10,
    attack: 1, defense: 5, hp: 20 * HP_MULT, energy: 5,
    abilities: [RegeneratingHeads],
    icon: "ra-hydra", color: "green", rarity: "legendary",
    flavor: "and now it has 6 heads",
  }

  const Dragon: CreatureTemplate = {
    kind: "creature",
    name: "Dragon", cost: 8,
    attack: 6, defense: 8, hp: 10 * HP_MULT, energy: 1,
    abilities: [],
    icon: "ra-wyvern", color: "red", rarity: "legendary",
    flavor: "It can't be real becomes if it was there would have been noone to start the stories",
  }

  const Nerd: CreatureTemplate = {
    kind: "creature",
    name: "Government Worker", cost: 1,
    attack: 0, defense: 0, hp: 1 * HP_MULT, energy: 1,
    abilities: [manaSpring],
    icon: "ra-player", color: "blue", rarity: "common",
    flavor: "he can't fight but he contributes in his own way",
  }

  const Pyromaniac: CreatureTemplate = {
    kind: "creature",
    name: "pyromaniac", cost: 1,
    attack: 3, defense: 0, hp: 6 * HP_MULT, energy: 2,
    //deal equal damage to self when attacking
    abilities: [thinksFireIsAToy],
    icon: "ra-player-pyromaniac", rarity: "uncommon",
    flavor: "already burned his own village down to feel its warmth, now he is on to yours",
  }

  const TheChosenOne: CreatureTemplate = {
    kind: "creature",
    name: "The Chosen One", cost: 2,
    attack: 1, defense: 1, hp: 1 * HP_MULT, energy: 1,
    //Key: get +10 to all stats except energy the first time it takes the castle
    //Sacred: all allies take 1 damage when killed
    abilities: [Smite, Key, Sacred],
    icon: "ra-aura", rarity: "legendary",
    flavor: "probably going to die for your greed",
  }

  const Mirror: CreatureTemplate = {
    kind: "creature",
    name: "mirror", cost: 3,
    attack: -1, defense: -1, hp: 2 * HP_MULT, energy: 1,
    //Reflection: use enemies attack when attacking and enemies defense when taking damage
    abilities: [Reflection],
    icon: "ra-mirror", rarity: "rare", attributes: ["magic"],
    flavor: "bro stole my moves",
  }

  const Zombie: CreatureTemplate = {
    kind: "creature",
    name: "Zombie", cost: 1,
    attack: 1, defense: 0, hp: 2 * HP_MULT, energy: 1,
    icon: "ra-monster-skull",
    abilities: [], attributes: ["undead"],
    flavor: "AHHHHHHHH HE IS COMING FOR MY BRAIN BRO",
  }

  const Vampire: CreatureTemplate = {
    kind: "creature",
    name: "Vampire", cost: 4,
    attack: 4, defense: 3, hp: 3 * HP_MULT, energy: 1,
    icon: "ra-monster-skull", rarity: "uncommon",
    // BloodSucker: reduce target energy by 1 when attacking. If this reduces them to 0
    //, kill them. Ability does not apply to constructions (creature can still attack them but the ability will have no effect)
    // gain +1 attack when killing a creature in this way
    abilities: [BloodSucker], attributes: ["undead"],
    flavor: "mi casa su casa",
  }

  const Tinkerer: CreatureTemplate = {
    kind: "creature",
    name: "Tinkerer", cost: 1,
    attack: 1, defense: 1, hp: 2 * HP_MULT, energy: 1,
    icon: 'ra-wrench', rarity: "rare",
    //heal adjaced constructions by 2 at start of round
    abilities: [Fixing], attributes: ["human"],
    flavor: "nerd",
  }

  const King: CreatureTemplate = {
    kind: "creature",
    name: "The King", cost: 3,
    attack: 3, defense: 3, hp: 3 * HP_MULT, energy: 1,
    icon: 'ra-player-king', rarity: "legendary",
    //leadership: grant +1 defense to adjacent allied creatures
    abilities: [Leadership, Sacred], attributes: ["human"],
    flavor: "his majesty has entered the chat",
  }

  const PotionDealer: CreatureTemplate = {
    kind: "creature",
    name: "Potion Dealer", cost: 2,
    attack: 1, defense: 1, hp: 2 * HP_MULT, energy: 1,
    icon: 'ra-bottle-vapors', rarity: "uncommon",
    //Give potion: give +3 attack and +3 defense to adjacent allied creatures (once per receving creatures)
    //When he dies: give -4 attack and -4 defense to all creatures that received
    abilities: [GivePotion, TakePotion], attributes: ["human", "magic"],
    flavor: "its a dark path",
  }

  const CrazySorcerress: CreatureTemplate = {
    kind: "creature",
    name: "Crazy Sorcerress", cost: 6,
    attack: 0, defense: 3, hp: 2 * HP_MULT, energy: 1,
    icon: 'ra-player-thunder-struck', rarity: "rare",
    //Power creep: deal 2 damage to all adjacent creatures and gain attack equal to the damage dealt
    abilities: [PowerCreep], attributes: ["human", "magic"],
    flavor: "the ends justify the means",
  }

  const Germ: CreatureTemplate = {
    kind: "creature",
    name: "The Plague", cost: 1,
    attack: 1, defense: 0, hp: 0.5 * HP_MULT, energy: 2,
    icon: 'ra-crown-of-thorns', rarity: "common",
    //start of round, spawn a copy of self in an adject square
    abilities: [SelfReplicate],
    flavor: "flatten the curve before its too late",
  }

  const trainedFighter: CreatureTemplate = {
    kind: "creature",
    name: "Trained Fighter", cost: 2,
    attack: 2, defense: 2, hp: 2 * HP_MULT, energy: 1,
    icon: 'ra-muscle-up', rarity: 'common',
    attributes: ["human"],
    abilities: [],
    flavor: "his sword has your name on it",
  }

  const WickedLeader: CreatureTemplate = {
    kind: "creature",
    name: "Wicked Leader", cost: 2,
    attack: 2, defense: 2, hp: 2 * HP_MULT, energy: 2,
    icon: 'ra-venomous-snake', rarity: 'common',
    abilities: [],
    flavor: "who elected this guy",
  }

  const Shark: CreatureTemplate = {
    kind: "creature",
    name: "Shark", cost: 3,
    attack: 4, defense: 3, hp: 3 * HP_MULT, energy: 1,
    icon: 'ra-shark', rarity: 'common', attributes: ['beast'],
    abilities: [],
    flavor: "swims and stuff idk",
  }

  const RocketShip: CreatureTemplate = {
    kind: "creature",
    name: "Rocket Ship", cost: 3,
    attack: 5, defense: 2, hp: 3 * HP_MULT, energy: 2,
    abilities: [],
    icon: 'ra-ship-emblem', rarity: 'common',
    flavor: "Traveled back in time to clean up your mess",
  }

  const Skeleton: CreatureTemplate = {
    kind: "creature",
    name: "skeleton", cost: 3,
    attack: 0, defense: 1, hp: 2 * HP_MULT, energy: 1,
    abilities: [coveringFire],
    icon: 'ra-broken-skull', rarity: 'uncommon',
    flavor: "always has a bow and arrow for some reason",
  }

  const Lich: CreatureTemplate = {
    kind: "creature",
    name: "Lich", cost: 6,
    attack: 6, defense: 4, hp: 10 * HP_MULT, energy: 2,
    abilities: [UndeadMaster],
    icon: 'ra-alien-fire', rarity: 'legendary',
    flavor: "lived long enough to become the vilan",
  }

  const creatures: CreatureTemplate[] = [
    CursedWarriorTemplate,
    SoulHarvesterTemplate,
    HealerTemplate,
    ShieldBearerTemplate,
    ThornWatcherTemplate,
    WarChieftainTemplate,
    RegularDude,
    Hydra,
    Dragon,
    Nerd,
    Pyromaniac,
    TheChosenOne,
    Mirror,
    Zombie,
    Vampire,
    Tinkerer,
    King,
    PotionDealer,
    CrazySorcerress,
    Germ,
    trainedFighter,
    WickedLeader,
    Shark,
    RocketShip,
    Skeleton,
    Lich,
    TheForbiddenOne,
  ];

  // ============================================================
  // CASTING TEMPLATE
  // ============================================================

  interface CastingTemplate extends Playable {
    kind: "casting";
    name:        string;
    cost:        number;
    description: string;
    targeting:   CastingTargeting;
    onPlay:      (state: GameState, caster: PlayerId, target?: Entity) => GameEvent[];
    icon?:       string;
    color?:      string;
    rarity?:     "common" | "uncommon" | "rare" | "legendary";
    flavor?:     string;
  }

  // ============================================================
  // CONSTRUCTION TEMPLATES
  // ============================================================

  const SniperTowerTemplate: ConstructionTemplate = {
    kind:      "construction",
    name:      "Sniper Tower",
    cost:      2,
    defense:   2,
    hp:        3,
    abilities: [coveringFire],
    icon:      "ra-tower",
    color:     "#708060",
    rarity:    "common",
    flavor:    "Patience is its only ammunition.",
  };

  const Nuclear: ConstructionTemplate = {
    kind: "construction",
    name: "Nuclear Research Facility",
    cost: 1,
    defense: 0,
    hp: 1,
    //Detonate: destroy all adjacent constructions and deal 5 damage to adjacent creatures when killed
    abilities: [manaSpring, Detonate],
    icon: "ra-radioactive",
    rarity: "uncommon",
    flavor: "infinitely safer than eating",
  }

  const Temple: ConstructionTemplate = {
    kind: "construction",
    name: "Temple",
    cost: 2,
    defense: 0,
    hp: 1,
    icon: "ra-lit-candelabra",
    //Sacred, see above
    abilities: [healingAura, manaSpring, Sacred],
    flavor: "defend at all costs",
  };

  const MagicSchool: ConstructionTemplate = {
    kind: "construction",
    name: "Magic School",
    cost: 2,
    defense: 3,
    hp: 2,
    icon: "ra-ammo-bag",
    //grant +1 attack to all allied creatures with magic attribute when they are spawned
    abilities: [MagicEducation],
    flavor: "the next generation",
  };

  const ManaConduitTemplate: ConstructionTemplate = {
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

  const constructions: ConstructionTemplate[] = [
    SniperTowerTemplate,
    ManaConduitTemplate,
    Nuclear,
    Temple,
    MagicSchool,
  ];

  // ============================================================
  // CASTING TEMPLATES
  // ============================================================

  const LightningBoltTemplate: CastingTemplate = {
    kind: "casting",
    name:   "Lightning Bolt",
    cost:   4,
    description: "Deal 10 damage to any entity on the board, ignoring defense.",
    targeting: { kind: "target", isLegal: () => true },
    onPlay(_state, _caster, target): GameEvent[] {
      if (!target) return [];
      return [{
        trigger: EventTime.take_damage,
        source:  "player",
        target:  target.id,
        amount:  10,
        log:     `Lightning Bolt strikes ${target.description} for 10!`,
      } as AmountEvent];
    },
    icon:   "ra-lightning-bolt",
    color:  "#c0a020",
    rarity: "rare",
    flavor: "No defense survives a direct strike from the sky.",
  };

  const HasteTemplate: CastingTemplate = {
    kind: "casting",
    name:   "Haste",
    cost:   2,
    description: "Refill one of your creatures' energy to full.",
    targeting: {
      kind: "target",
      isLegal: (_state, caster, candidate) =>
        candidate.entity instanceof Creature && candidate.controller === caster,
    },
    onPlay(state, _caster, target): GameEvent[] {
      if (!target || !(target.entity instanceof Creature)) return [];
      target.entity.remaining_energy = target.entity.base_energy;
      state.log.push(`Haste restores ${target.description} to full energy (${target.entity.base_energy}).`);
      return [];
    },
    icon:   "ra-pills",
    color:  "#2080c0",
    rarity: "uncommon",
    flavor: "Move again. The enemy won't see it coming.",
  };

  const MendTemplate: CastingTemplate = {
    kind: "casting",
    name:   "Mend",
    cost:   3,
    description: "Fully heal a damaged entity (ally or enemy).",
    targeting: {
      kind: "target",
      isLegal: (_state, _caster, candidate) =>
        candidate.entity.remaining_hp < candidate.entity.base_hp,
    },
    onPlay(_state, _caster, target): GameEvent[] {
      if (!target) return [];
      return [{
        trigger: EventTime.take_damage,
        source:  "player",
        target:  target.id,
        amount:  -(target.entity.base_hp - target.entity.remaining_hp),
        log:     `Mend restores ${target.description} to full health.`,
      } as AmountEvent];
    },
    icon:   "ra-health",
    color:  "#40a060",
    rarity: "uncommon",
    flavor: "The wound remembers it never existed.",
  };

  const IronSkinTemplate: CastingTemplate = {
    kind: "casting",
    name:   "Iron Skin",
    cost:   2,
    description: "Permanently grant one of your entities +3 defense.",
    targeting: {
      kind: "target",
      isLegal: (_state, caster, candidate) => candidate.controller === caster,
    },
    onPlay(state, _caster, target): GameEvent[] {
      if (!target) return [];
      target.entity.defense += 3;
      state.log.push(`Iron Skin grants ${target.description} +3 defense (now ${target.entity.defense}).`);
      return [];
    },
    icon:   "ra-shield-2",
    color:  "#507090",
    rarity: "common",
    flavor: "Flesh becomes iron. Iron becomes legend.",
  };

  const Necromancy: CastingTemplate = {
    kind: "casting",
    name:   "Necromancy Wave",
    cost:   2,
    description: "Give +1 attack to all your constructions and tag them as undead.",
    targeting: { kind: "none" },
    onPlay(state, caster, _target): GameEvent[] {
      for (let e of state.allEntities()) {
        if (e.controller != caster) { continue; }
        if (e.entity.kind !== "construction") { continue; }
        let c = (e.entity as Creature);
        c.attack += 1;
        if (c.attributes === null) {
          c.attributes = [];
        }

        c.attributes.push("undead");
      }
      state.log.push(`Granted +1 attack to all creatures and made them undead`);
      return [];
    },
    icon:   "ra-broken-skull",
    color:  "#507090",
    rarity: "common",
    flavor: "they gon eat brain",
  };

  const HolyBoon: CastingTemplate = {
    kind: "casting",
    name:   "Holy Boon",
    cost:   5,
    description: "Grant a target ally creature Smite, +3 attack, and +1 defense.",
    targeting: {
      kind: "target",
      isLegal: (_s, caster, candidate) =>
        candidate.entity instanceof Creature && candidate.controller === caster,
    },
    onPlay(state, _caster, target): GameEvent[] {
      if (!target) { return []; }
      const c = target.entity as Creature;
      c.abilities.push(Smite);
      c.attack += 3;
      c.defense += 1;
      state.log.push(`Gave smite, +3 attack and +1 defense to ${target.description}`);
      return [];
    },
    icon:   "ra-player-dodge ",
    color:  "#507090",
    rarity: "common",
    flavor: "go get em",
  };

  const BoonOfForbiddance: CastingTemplate = {
    kind: "casting",
    name:   "Holy Boon",
    cost:   2,
    description: "Grant a target ally creature +2 attack and +1 energy. This creature will not be able to enter the castle.",
    targeting: {
      kind: "target",
      isLegal: (_s, _caster, candidate) =>
        candidate.entity instanceof Creature
    },
    onPlay(state, _caster, target): GameEvent[] {
      if (!target) { return []; }
      const c = target.entity as Creature;
      c.abilities.push(ForbiddenMove);
      c.abilities.push(ForbiddenAttack);
      c.attack += 2;
      c.base_energy += 1;
      state.log.push(`+2 attack and +1 energy to ${target.description}. It can no longer enter the caste.`);
      return [];
    },
    icon:   "ra-unplugged",
    color:  "#507090",
    rarity: "common",
    flavor: "go get em",
  };

  const SolarPanels: CastingTemplate = {
    kind:   "casting",
    name:   "Atatch Solar Panels",
    cost:   10,
    description: "Grant a creature +1 energy",
    targeting: {
      kind: "target",
      isLegal: (_s, caster, candidate) =>
        candidate.entity instanceof Creature && candidate.controller === caster,
    },
    onPlay(state, _caster, target): GameEvent[] {
      if (!target) { return []; }
      const c = target.entity as Creature;
      c.abilities.push(Smite);
      c.base_energy += 1;
      c.remaining_energy += 1
      state.log.push(`Attatched solar panels granting +1 energy to ${target.description}`);
      return [];
    },
    icon:   "ra-moon-sun",
    color:  "#507090",
    rarity: "common",
    flavor: "go get em",
  };

  const Genocide: CastingTemplate = {
    kind:   "casting",
    name:   "Genocide",
    cost:   4,
    description: "Kill every entity on the board that shares the target's name.",
    targeting: {
      kind: "target",
      isLegal: () => true,
    },
    onPlay(state, _caster, target): GameEvent[] {
      if (!target) return [];
      const name = target.entity.name;
      return state
        .allEntities()
        .filter(e => e.entity.name === name)
        .map(e => ({
          trigger: EventTime.killed,
          source:  "player",
          target:  e.id,
          log:     `Genocide kills ${e.description}.`,
        } as SimpleEvent));
    },
    icon:   "ra-death-skull",
    color:  "#a04040",
    rarity: "rare",
    flavor: "Kill them all.",
  };

  const Clone: CastingTemplate = {
    kind:   "casting",
    name:   "Clone",
    cost:   6,
    description: "Spawn a copy of a target creature in a random empty square adjacent to it.",
    targeting: {
      kind: "target",
      isLegal: (state, _caster, candidate) => {
        if (!(candidate.entity instanceof Creature)) return false;
        const coords = state.findCoords(candidate.id);
        if (!coords) return false;
        return adjacentCoords(coords).some(p => !state.getEntityAt(p));
      },
    },
    onPlay(state, caster, target): GameEvent[] {
      if (!target) return [];
      if (!(target.entity instanceof Creature)) return [];
      const coords = state.findCoords(target.id);
      if (!coords) return [];
      const empty = adjacentCoords(coords).filter(p => !state.getEntityAt(p));
      if (empty.length === 0) return [];
      const spot = empty[Math.floor(Math.random() * empty.length)];
      const src = target.entity;
      const tpl: CreatureTemplate = {
        kind:       "creature",
        name:       src.name,
        cost:       0,
        attack:     src.attack,
        defense:    src.defense,
        hp:         src.base_hp,
        energy:     src.base_energy,
        abilities:  src.abilities,
        attributes: [...src.attributes],
      };
      const clone = state.spawn(tpl, caster, spot, "player");
      state.log.push(`Clone creates a copy of ${target.description} at (${spot.x},${spot.y}) → ${clone.description}.`);
      return [];
    },
    icon:   "ra-double-team",
    color:  "#60a0c0",
    rarity: "rare",
    flavor: "One becomes two, two becomes battle.",
  };

  const castings: CastingTemplate[] = [
    LightningBoltTemplate,
    HasteTemplate,
    MendTemplate,
    IronSkinTemplate,
    Necromancy,
    HolyBoon,
    SolarPanels,
    Genocide,
    Clone,
  ];

  // ── Constants ───────────────────────────────────────────────────────────────
  const CASTLE_IDX      = 12;
  const CASTLE_HOLD_WIN = 3;
  const PLAYER_IDS: PlayerId[] = ["A", "B"];

  const RARITY_COLORS: Record<string, string> = {
    common:    '#808080',
    uncommon:  '#40a060',
    rare:      '#4060c0',
    legendary: '#c08020',
  };

  // ── Game initialisation ─────────────────────────────────────────────────────
  function makeDeck(): Deck {
    return new Deck(
      creatures.sort(() => Math.random()),
      constructions.sort(() => Math.random()),
      castings.sort(() => Math.random()),
    );
  }

  // ============================================================
  // MULTIPLAYER: serialization registries + WS client
  // ============================================================

  const ABILITY_REGISTRY: Record<string, Ability> = {};
  for (const ab of [
    healingAura, damageShield, Smite, deathCurse, gainManaOnDeath, thornAura,
    warCry, RegeneratingHeads, coveringFire, manaSpring,
    thinksFireIsAToy, Key, Sacred, Reflection, BloodSucker, Fixing, Leadership,
    GivePotion, TakePotion, PowerCreep, SelfReplicate, Detonate, MagicEducation,
    UndeadMaster, ForbiddenMove, ForbiddenAttack,
  ]) { ABILITY_REGISTRY[ab.name] = ab; }

  const PASSIVE_REGISTRY: Record<string, Passive> = {};
  for (const p of [...ALL_BUFFS, ...ALL_CURSES]) PASSIVE_REGISTRY[p.id] = p;

  const TEMPLATE_REGISTRY: Record<string, CreatureTemplate | ConstructionTemplate | CastingTemplate> = {};
  for (const t of [...creatures, ...constructions, ...castings]) TEMPLATE_REGISTRY[t.name] = t;

  function serializeEntity(e: Entity | null): any {
    if (!e) return null;
    const inner = e.entity;
    const base: any = {
      name: inner.name,
      kind: inner.kind,
      defense: inner.defense,
      base_hp: inner.base_hp,
      remaining_hp: inner.remaining_hp,
      abilityNames: inner.abilities.map(a => a.name),
      attributes: [...inner.attributes],
    };
    if (inner instanceof Creature) {
      base.attack = inner.attack;
      base.base_energy = inner.base_energy;
      base.energy_remaining = inner.remaining_energy;
    }
    return { id: e.id, controller: e.controller, description: e.description, inner: base };
  }

  function rehydrateEntity(dto: any): Entity | null {
    if (!dto) return null;
    const i = dto.inner;
    const abilities = i.abilityNames.map((n: string) => ABILITY_REGISTRY[n]).filter(Boolean);
    const attrs: Attribute[] = Array.isArray(i.attributes) ? [...i.attributes] : [];
    let inner: Creature | Construction;
    if (i.kind === "creature") {
      const c = new Creature(i.name, i.attack, i.defense, i.base_hp, i.base_energy, abilities, attrs);
      c.remaining_hp = i.remaining_hp;
      c.remaining_energy = i.energy_remaining;
      inner = c;
    } else {
      inner = new Construction(i.name, i.defense, i.base_hp, abilities, attrs);
      inner.remaining_hp = i.remaining_hp;
    }
    return { id: dto.id, controller: dto.controller, description: dto.description, entity: inner };
  }

  function serializeDeck(d: Deck): any {
    return {
      i_vals: { ...d.i_vals },
      cardNames: {
        creature:     d.cards.creature.map(t => t ? t.name : null),
        construction: d.cards.construction.map(t => t ? t.name : null),
        casting:      d.cards.casting.map(t => t ? t.name : null),
      },
    };
  }

  function rehydrateDeck(dto: any): Deck {
    const lookup = (n: string | null) => (n ? TEMPLATE_REGISTRY[n] ?? null : null);
    const d = new Deck(
      dto.cardNames.creature.map(lookup) as (CreatureTemplate | null)[] as CreatureTemplate[],
      dto.cardNames.construction.map(lookup) as (ConstructionTemplate | null)[] as ConstructionTemplate[],
      dto.cardNames.casting.map(lookup) as (CastingTemplate | null)[] as CastingTemplate[],
    );
    d.i_vals = { ...dto.i_vals };
    return d;
  }

  function serializePact(p: Pact | null): any {
    if (!p) return null;
    return { id: p.id, buffId: p.buff?.id ?? null, curseId: p.curse?.id ?? null };
  }

  function rehydratePact(dto: any): Pact | null {
    if (!dto) return null;
    return {
      id: dto.id,
      buff:  dto.buffId  ? (PASSIVE_REGISTRY[dto.buffId]  ?? null) : null,
      curse: dto.curseId ? (PASSIVE_REGISTRY[dto.curseId] ?? null) : null,
    };
  }

  function serializeOffering(offering: Pact[]): any {
    return offering.map(serializePact);
  }

  function rehydrateOffering(dtos: any[]): Pact[] {
    return dtos.map(rehydratePact).filter((p): p is Pact => p !== null);
  }

  function serializeGameState(s: GameState): any {
    return {
      turn: s.turn,
      turnNumber: s.turnNumber,
      next_id: s.next_id,
      log: [...s.log],
      grid: s.grid.map(serializeEntity),
      players: {
        A: { id: s.players.A.id, mana: s.players.A.mana, castleHolds: s.players.A.castleHolds },
        B: { id: s.players.B.id, mana: s.players.B.mana, castleHolds: s.players.B.castleHolds },
      },
      decks:    { A: serializeDeck(s.decks.A),    B: serializeDeck(s.decks.B) },
      reserves: { A: serializeDeck(s.reserves.A), B: serializeDeck(s.reserves.B) },
      pacts:    { A: serializePact(s.pacts.A),    B: serializePact(s.pacts.B) },
    };
  }

  function rehydrateGameState(dto: any): GameState {
    // Use the real constructor so $state-decorated fields are reactive, then overwrite.
    const s = new GameState(makeDeck());
    s.turn       = dto.turn;
    s.turnNumber = dto.turnNumber;
    s.next_id    = dto.next_id ?? 0;
    s.log        = [...dto.log];
    s.grid       = dto.grid.map(rehydrateEntity);
    const pA = new PlayerState('A', dto.players.A.mana, dto.players.A.castleHolds);
    const pB = new PlayerState('B', dto.players.B.mana, dto.players.B.castleHolds);
    s.players  = { A: pA, B: pB };
    s.decks    = { A: rehydrateDeck(dto.decks.A),    B: rehydrateDeck(dto.decks.B) };
    s.reserves = { A: rehydrateDeck(dto.reserves.A), B: rehydrateDeck(dto.reserves.B) };
    s.pacts    = { A: rehydratePact(dto.pacts.A),    B: rehydratePact(dto.pacts.B) };
    return s;
  }

  // ── WebSocket client ───────────────────────────────────────────────────────
  let ws: WebSocket | null = null;
  let myPlayerId:        PlayerId | null = $state(null);
  let opponentConnected: boolean         = $state(false);
  let connectionStatus:  string          = $state("connecting…");
  let applyingRemoteUpdate = false;

  function wsUrl(): string {
    if (typeof window === 'undefined') return '';
    const pageProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const raw = ((import.meta.env.VITE_WS_URL as string | undefined) ?? '').trim();
    if (raw) {
      if (/^wss?:\/\//i.test(raw)) return raw;
      if (/^https?:\/\//i.test(raw)) return raw.replace(/^http/i, 'ws');
      // Bare hostname — assume secure if the page is served over https.
      return `${pageProto}//${raw.replace(/^\/+/, '')}`;
    }
    return `${pageProto}//${window.location.hostname}:8080`;
  }

  function connectWS(): void {
    if (typeof window === 'undefined') return;
    try { ws = new WebSocket(wsUrl()); } catch { connectionStatus = "connection failed"; return; }
    ws.onopen    = () => { connectionStatus = "connected, awaiting role…"; };
    ws.onclose   = () => { connectionStatus = "disconnected"; ws = null; };
    ws.onerror   = () => { connectionStatus = "connection error"; };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      if (msg.type === 'assign') {
        myPlayerId = msg.you;
        connectionStatus = `you are player ${msg.you}`;
      } else if (msg.type === 'presence') {
        opponentConnected = !!msg.opponentConnected;
      } else if (msg.type === 'full') {
        connectionStatus = "room full — try again later";
      } else if (msg.type === 'request_state') {
        sendFullState();
      } else if (msg.type === 'state') {
        applyRemoteState(msg.state, msg.offering);
      }
    };
  }

  function sendFullState(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'state',
      state: serializeGameState(game_state),
      offering: serializeOffering(pactOffering),
    }));
  }

  function applyRemoteState(stateDto: any, offeringDto: any[] | undefined): void {
    applyingRemoteUpdate = true;
    game_state = rehydrateGameState(stateDto);
    if (offeringDto) pactOffering = rehydrateOffering(offeringDto);
    for (const pid of ["A", "B"] as PlayerId[]) {
      if (game_state.players[pid].castleHolds >= 3) winner = pid;
    }
    applyingRemoteUpdate = false;
  }

  function broadcastAfterAction(): void {
    if (applyingRemoteUpdate) return;
    sendFullState();
  }

  onMount(connectWS);

  let game_state = $state(new GameState(makeDeck()));

  // ── Pact selection state ────────────────────────────────────────────────────
  const PACT_OFFER_COUNT = 3;
  let pactOffering: Pact[] = $state(generatePactOffering(PACT_OFFER_COUNT));

  function selectPact(pact: Pact): void {
    if (!myPlayerId) return;
    if (game_state.pacts[myPlayerId]) return;
    game_state.pacts[myPlayerId] = { id: pact.id, buff: pact.buff, curse: pact.curse };
    game_state.log.push(`Player ${myPlayerId} binds the pact: ${pact.buff?.name} / ${pact.curse?.name}.`);
    const other: PlayerId = myPlayerId === "A" ? "B" : "A";
    if (game_state.pacts[other]) {
      game_state.log.push(`--- Turn 1: Player ${game_state.turn} (${game_state.players[game_state.turn].mana} mana) ---`);
      game_state.fireTurnStart(game_state.turn);
    }
    broadcastAfterAction();
  }

  // ── Derived display snapshots ───────────────────────────────────────────────
  let grid    = $derived([...game_state.grid]);
  let turn    = $derived(game_state.turn);
  let viewOrder = $derived(
    (myPlayerId ?? 'A') === 'A'
      ? Array.from({ length: NUM_CELLS }, (_, k) => k)
      : Array.from({ length: NUM_CELLS }, (_, k) => NUM_CELLS - 1 - k)
  );
  let bothPactsPicked = $derived(!!game_state.pacts.A && !!game_state.pacts.B);
  let myTurn          = $derived(!!myPlayerId && myPlayerId === turn && bothPactsPicked);
  let players = $derived(game_state.players);
  let hands   = $derived(game_state.reserves);
  let gameLog = $derived([...game_state.log].reverse().slice(0, 50));
  let opp     = $derived(game_state.opponent(game_state.turn));
  let turnNum = $derived(game_state.turnNumber);
  let mana    = $derived(game_state.players[game_state.turn].mana);

  // ── Win condition ────────────────────────────────────────────────────────────
  let winner: PlayerId | null = $state(null);

  // ── Inspector ────────────────────────────────────────────────────────────────
  type Inspected =
    | { kind: 'hand';      card:    Playable }
    | { kind: 'board';     entity:  Entity   }
    | { kind: 'passive';   passive: Passive; owner: PlayerId }
    | { kind: 'ability';   ability: Ability; owner: PlayerId; entityName: string }
    | { kind: 'attribute'; attribute: Attribute; owner: PlayerId; entityName: string }
    | null;

  const ATTRIBUTE_META: Record<Attribute, { icon: string; color: string; description: string }> = {
    undead:       { icon: 'ra-skull',       color: '#a080c0', description: 'Counts as undead for effects that care (e.g. Necromancy, holy damage).' },
    human:        { icon: 'ra-player',      color: '#d0b080', description: 'Counts as human for effects that target humans.' },
    magic:        { icon: 'ra-crystal-ball',color: '#80a0ff', description: 'Counts as magical for effects that target magic.' },
    has_potion:   { icon: 'ra-round-potion',color: '#60c080', description: 'Drank the kool aid' },
    beast:        { icon: 'ra-wolf-head',   color: 'gray', description: 'Carries a potion that can be consumed or stolen.' },
  };

  let inspected: Inspected = $state(null);

  // ── Drag state ───────────────────────────────────────────────────────────────
  type DragMode = 'hand' | 'move' | 'attack';
  let dragMode:     DragMode | null = $state(null);
  let dragCardIdx:  number | null   = null;
  let dragCardKind: CardType | null = null;
  let dragFromId:   number | null   = null;
  let dragOverIdx:  number | null   = $state(null);

  function handDragStart(e: DragEvent, idx: number, k: CardType) {
    if (winner) { e.preventDefault(); return; }
    const card = hands[turn].cards[k][idx];
    if (!card || card.cost > players[turn].mana) { e.preventDefault(); return; }
    dragMode     = 'hand';
    dragCardIdx  = idx;
    dragCardKind = k;
    e.dataTransfer!.effectAllowed = 'copy';
  }

  function boardDragStart(e: DragEvent, cellIdx: number) {
    if (winner) { e.preventDefault(); return; }
    const entity = grid[cellIdx];
    if (!entity || entity.controller !== turn) { e.preventDefault(); return; }
    const creature = entity.entity instanceof Creature ? entity.entity : null;
    if (!creature || creature.remaining_energy <= 0) { e.preventDefault(); return; }
    dragMode   = 'move';
    dragFromId = entity.id;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function draggedCastingTemplate(): CastingTemplate | null {
    if (dragMode !== 'hand' || dragCardKind !== 'casting' || dragCardIdx === null) return null;
    return (hands[turn].cards['casting'][dragCardIdx] as CastingTemplate | undefined) ?? null;
  }

  function onDragOver(e: DragEvent, cellIdx: number) {
    e.preventDefault();
    dragOverIdx = cellIdx;
    const targetEntity = grid[cellIdx];

    if (dragMode === 'hand') {
      if (dragCardKind === 'casting') {
        const tpl = draggedCastingTemplate();
        const legal = tpl ? game_state.canTargetCasting(tpl, index_to_coords(cellIdx)) : false;
        e.dataTransfer!.dropEffect = legal ? 'copy' : 'none';
      } else {
        e.dataTransfer!.dropEffect = targetEntity ? 'none' : 'copy';
      }
    } else {
      dragMode = (targetEntity && targetEntity.controller !== turn) ? 'attack' : 'move';
      e.dataTransfer!.dropEffect = 'move';
    }
  }

  function onDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    if (winner || !myTurn) { resetDrag(); return; }

    const toCoords     = index_to_coords(toIdx);
    const targetEntity = grid[toIdx];

    if (dragMode === 'hand' && dragCardIdx !== null && dragCardKind !== null) {
      const result = game_state.play(dragCardIdx, toCoords, dragCardKind);
      if (result === 'not_enough_mana') game_state.log.push('Not enough mana!');
      if (result === 'invalid_coords')  game_state.log.push('Cannot place there.');
      if (result === 'invalid_target')  game_state.log.push('Illegal target.');
    } else if ((dragMode === 'move' || dragMode === 'attack') && dragFromId !== null) {
      if (targetEntity && targetEntity.controller !== turn) {
        game_state.attack(dragFromId, targetEntity.id);
      } else if (!targetEntity) {
        game_state.move(dragFromId, toCoords);
      }
    }

    resetDrag();
    broadcastAfterAction();
  }

  function resetDrag() {
    dragMode     = null;
    dragCardIdx  = null;
    dragCardKind = null;
    dragFromId   = null;
    dragOverIdx  = null;
  }

  // ── Turn management ──────────────────────────────────────────────────────────
  function endTurn() {
    if (winner) return;
    if (!myTurn) return;
    const currentTurn = game_state.turn;

    const castleEntity = game_state.grid[CASTLE_IDX];
    if (castleEntity?.controller === currentTurn) {
      game_state.players[currentTurn].castleHolds++;
      game_state.log.push(
        `${currentTurn} holds the castle — ${game_state.players[currentTurn].castleHolds}/${CASTLE_HOLD_WIN}.`
      );
      if (game_state.players[currentTurn].castleHolds >= CASTLE_HOLD_WIN) {
        winner = currentTurn;
        game_state.log.push(`🏰 Player ${currentTurn} wins by holding the castle!`);
        return;
      }
    } else {
      game_state.players[currentTurn].castleHolds = 0;
    }

    game_state.nextTurn();
    broadcastAfterAction();
  }

  function rerollSlot(idx: number, kind: CardType, e: Event) {
    e.stopPropagation();
    e.preventDefault();
    if (winner || !myTurn) return;
    if (!game_state.reroll(idx, kind)) {
      game_state.log.push('Not enough mana to reroll.');
      return;
    }
    if (inspected?.kind === 'hand') inspected = null;
    broadcastAfterAction();
  }

  // ── UI helpers ───────────────────────────────────────────────────────────────
  function uiMeta(name: string) {
    const allTemplates = [...creatures, ...constructions, ...castings];
    const t = allTemplates.find(c => c.name === name);
    return {
      icon:   (t as any)?.icon   ?? 'ra-sword',
      color:  (t as any)?.color  ?? '#c0b080',
      rarity: (t as any)?.rarity ?? ('common' as const),
      flavor: (t as any)?.flavor ?? '',
    };
  }

  function playerColor(pid: PlayerId) { return pid === 'A' ? '#6ab0ff' : '#ff7060'; }

  function cellClass(i: number): string {
    const parts = ['cell'];
    if (i === CASTLE_IDX) parts.push('castle-cell');
    if (dragOverIdx === i) parts.push('drag-over');
    const coords = index_to_coords(i);
    const rowOwner: PlayerId = myPlayerId ?? 'A';
    if (coords.x === playRowX(rowOwner)) {
      parts.push(rowOwner === 'A' ? 'play-row-a' : 'play-row-b');
    }
    const entity = grid[i];
    if (entity) {
      parts.push(entity.controller === 'A' ? 'cell-a' : 'cell-b');
      if (dragFromId !== null && entity.id === dragFromId) parts.push('cell-lifting');
    }
    if (dragMode === 'hand' && dragCardKind === 'casting') {
      const tpl = draggedCastingTemplate();
      if (tpl) {
        if (tpl.targeting.kind === 'none') {
          parts.push('casting-any');
        } else if (game_state.canTargetCasting(tpl, index_to_coords(i))) {
          parts.push('casting-legal');
        } else {
          parts.push('casting-illegal');
        }
      }
    }
    return parts.join(' ');
  }

  function restart() {
    game_state    = new GameState(makeDeck());
    winner        = null;
    inspected     = null;
    pactOffering  = generatePactOffering(PACT_OFFER_COUNT);
    resetDrag();
    broadcastAfterAction();
  }
</script>

<!-- ─── Markup ───────────────────────────────────────────────────────────── -->
{#if !myPlayerId}
  <div class="pact-overlay">
    <div class="pact-modal">
      <h1 class="pact-title">Connecting…</h1>
      <p class="pact-sub">{connectionStatus}</p>
    </div>
  </div>
{:else if !game_state.pacts[myPlayerId]}
  <div class="pact-overlay">
    <div class="pact-modal">
      <h1 class="pact-title">Bind Your Pact</h1>
      <p class="pact-sub">
        Player <strong style="color:{playerColor(myPlayerId)}">{myPlayerId}</strong>, choose one pair —
        both its gift and its price will last the whole match.
        {#if !opponentConnected}<br /><em style="opacity:0.7">(Waiting for opponent…)</em>{/if}
      </p>
      <div class="pact-grid">
        {#each pactOffering as pact (pact.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="pact-card" onclick={() => selectPact(pact)}>
            {#if pact.buff}
              <div class="pact-half pact-buff">
                <i class="ra {pact.buff.icon}" style="color:{pact.buff.color}"></i>
                <div class="pact-half-name">{pact.buff.name}</div>
                <div class="pact-half-desc">{pact.buff.description}</div>
              </div>
            {/if}
            <div class="pact-divider">⇅</div>
            {#if pact.curse}
              <div class="pact-half pact-curse">
                <i class="ra {pact.curse.icon}" style="color:{pact.curse.color}"></i>
                <div class="pact-half-name">{pact.curse.name}</div>
                <div class="pact-half-desc">{pact.curse.description}</div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{:else if !bothPactsPicked}
  <div class="pact-overlay">
    <div class="pact-modal">
      <h1 class="pact-title">Pact Bound</h1>
      <p class="pact-sub">Waiting for opponent to choose their pact…</p>
    </div>
  </div>
{/if}

<div class="app">
  <!-- HEADER -->
  <header class="hdr">
    <div class="hdr-brand">
      <i class="ra ra-castle-emblem"></i>
      <span>Castle Hold</span>
    </div>

    <div class="pact-corners">
      {#each PLAYER_IDS as pid}
        {@const pact = game_state.pacts[pid]}
        {#if pact}
          <div class="pact-corner" title="Player {pid} pact: {pact.buff?.name ?? '—'} / {pact.curse?.name ?? '—'}">
            <span class="pact-corner-label" style="color:{playerColor(pid)}">P{pid}</span>
            {#if pact.buff}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <i role="button" tabindex="0" class="ra {pact.buff.icon} pact-corner-icon pact-corner-clickable" style="color:{pact.buff.color}" title="{pact.buff.name}: {pact.buff.description}" onclick={() => { inspected = { kind: 'passive', passive: pact.buff!, owner: pid }; }}></i>
            {:else}
              <i class="ra ra-broken-heart pact-corner-icon pact-spent" title="Buff consumed"></i>
            {/if}
            <span class="pact-corner-slash">/</span>
            {#if pact.curse}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <i role="button" tabindex="0" class="ra {pact.curse.icon} pact-corner-icon pact-corner-clickable" style="color:{pact.curse.color}" title="{pact.curse.name}: {pact.curse.description}" onclick={() => { inspected = { kind: 'passive', passive: pact.curse!, owner: pid }; }}></i>
            {:else}
              <i class="ra ra-broken-heart pact-corner-icon pact-spent" title="Curse lifted"></i>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <div class="hdr-turn">
      {#if winner}
        <span class="winner-badge" style="color:{playerColor(winner)}">⚔ Player {winner} wins!</span>
        <button class="btn-restart" onclick={restart}>New game</button>
      {:else}
        <span class="active-pip" style="background:{playerColor(turn)}"></span>
        <span>Player <strong>{turn}</strong> — Turn {turnNum}</span>
        <span class="stat-chip mana-chip">
          <i class="ra ra-crystal-ball"></i>{mana} mana
        </span>
        <span class="stat-chip hold-chip" title="Castle hold turns">
          <i class="ra ra-tower"></i>{players[turn].castleHolds}/{CASTLE_HOLD_WIN}
        </span>
        {#if myTurn}
          <button class="btn-end-turn" onclick={endTurn}>End Turn →</button>
        {/if}
      {/if}
    </div>
  </header>

  <!-- BODY: left inspector | arena | right log -->
  <div class="body">

    <!-- LEFT SIDEBAR: Inspector only -->
    <aside class="sidebar-left">
      {#if inspected?.kind === 'hand'}
        {@const card = inspected.card}
        {@const meta = uiMeta(card.name)}
        {@const v = card.kind}
        <div class="insp">
          <div class="insp-glow" style="--ec:{meta.color}"></div>
          <div class="insp-ring" style="border-color:{meta.color}55; background:{meta.color}0d">
            <i class="ra {meta.icon}" style="color:{meta.color}"></i>
          </div>
          <h2 class="insp-name">{card.name}</h2>
          <div class="insp-cost"><i class="ra ra-crystal-ball"></i> {card.cost} mana</div>
          <span class="rarity-pill" style="color:{RARITY_COLORS[meta.rarity]}">{meta.rarity}</span>
          {#if v === 'casting'}
            <span class="kind-badge casting-badge">⚡ Instant Spell</span>
          {:else if v === 'construction'}
            <span class="kind-badge construction-badge">🏗 Construction</span>
          {:else}
            <span class="kind-badge creature-badge">⚔ Creature</span>
          {/if}
          {#if meta.flavor}
            <blockquote class="insp-flavor">"{meta.flavor}"</blockquote>
          {/if}
          {#if v === 'casting'}
            <div class="divider"><span>EFFECT</span></div>
            <p class="passive-desc">{(card as CastingTemplate).description}</p>
            <p class="casting-hint">
              {(card as CastingTemplate).targeting.kind === 'none'
                ? 'Drag onto the board to cast — no target needed.'
                : 'Drag onto a board entity to target it.'}
            </p>
          {:else}
            <div class="divider"><span>STATS</span></div>
            {#if v == "construction"}
              {@const c = card as ConstructionTemplate}
              <ul class="stat-list">
                <li class="stat-row"><span class="stat-k">DEF</span><span class="stat-v">{c.defense}</span></li>
                <li class="stat-row"><span class="stat-k">HP</span><span class="stat-v">{c.hp}</span></li>
              </ul>
              {#if c.abilities.length > 0}
                <div class="divider"><span>ABILITIES</span></div>
                <ul class="stat-list">
                  {#each c.abilities as ab}
                    <li class="stat-row ability-row">
                      <i class="ra ra-lightning"></i>
                      <div class="ab-body">
                        <span class="ab-name">{ab.name}</span>
                        {#if ab.description}
                          <span class="ab-desc">{ab.description}</span>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
            {#if v == "creature"}
              {@const c = card as CreatureTemplate}
              <ul class="stat-list">
                <li class="stat-row">
                  <span class="stat-k">ATK</span>
                  <span class="stat-v">{c.attack}</span>
                </li>
                <li class="stat-row"><span class="stat-k">DEF</span><span class="stat-v">{c.defense}</span></li>
                <li class="stat-row"><span class="stat-k">HP</span><span class="stat-v">{c.hp}</span></li>
                <li class="stat-row"><span class="stat-k">ENERGY</span><span class="stat-v">{c.energy}</span></li>
              </ul>
              {#if c.abilities.length > 0}
                <div class="divider"><span>ABILITIES</span></div>
                <ul class="stat-list">
                  {#each c.abilities as ab}
                    <li class="stat-row ability-row">
                      <i class="ra ra-lightning"></i>
                      <div class="ab-body">
                        <span class="ab-name">{ab.name}</span>
                        {#if ab.description}
                          <span class="ab-desc">{ab.description}</span>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/if}
        </div>
      {:else if inspected?.kind === 'board'}
        {@const entity   = inspected.entity}
        {@const stats    = entity.entity}
        {@const creature = stats instanceof Creature ? stats : null}
        {@const meta     = uiMeta(stats.name)}
        <div class="insp">
          <div class="insp-glow" style="--ec:{meta.color}"></div>
          <div class="insp-ring" style="border-color:{meta.color}55; background:{meta.color}0d">
            <i class="ra {meta.icon}" style="color:{meta.color}"></i>
          </div>
          <h2 class="insp-name">{stats.name}</h2>
          <span class="controller-badge" style="color:{playerColor(entity.controller)}">
            Player {entity.controller}
          </span>
          <div class="divider"><span>STATS</span></div>
          <ul class="stat-list">
            {#if creature}
              <li class="stat-row"><span class="stat-k">ATK</span><span class="stat-v">{creature.attack}</span></li>
              <li class="stat-row"><span class="stat-k">DEF</span><span class="stat-v">{creature.defense}</span></li>
              <li class="stat-row">
                <span class="stat-k">HP</span>
                <span class="stat-v hp-val" style="--hpc:{creature.remaining_hp / creature.base_hp}">
                  {creature.remaining_hp}/{creature.base_hp}
                </span>
              </li>
              <li class="stat-row">
                <span class="stat-k">ENERGY</span>
                <span class="stat-v" style="color:{creature.remaining_energy > 0 ? '#80d090' : '#d05050'}">
                  {creature.remaining_energy}/{creature.base_energy}
                </span>
              </li>
            {:else}
              <li class="stat-row"><span class="stat-k">DEF</span><span class="stat-v">{stats.defense}</span></li>
              <li class="stat-row">
                <span class="stat-k">HP</span>
                <span class="stat-v hp-val" style="--hpc:{stats.remaining_hp / stats.base_hp}">
                  {stats.remaining_hp}/{stats.base_hp}
                </span>
              </li>
            {/if}
          </ul>
          {#if stats.attributes && stats.attributes.length > 0}
            <div class="divider"><span>ATTRIBUTES</span></div>
            <ul class="attr-list">
              {#each stats.attributes as attr}
                {@const am = ATTRIBUTE_META[attr]}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <li
                  class="attr-chip"
                  role="button"
                  tabindex="0"
                  style="border-color:{am.color}55; background:{am.color}12"
                  onclick={() => { inspected = { kind: 'attribute', attribute: attr, owner: entity.controller, entityName: stats.name }; }}
                >
                  <i class="ra {am.icon}" style="color:{am.color}"></i>
                  <span>{attr}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if stats.abilities.length > 0}
            <div class="divider"><span>ABILITIES</span></div>
            <ul class="stat-list">
              {#each stats.abilities as ab}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <li
                  class="stat-row ability-row ability-clickable"
                  role="button"
                  tabindex="0"
                  onclick={() => { inspected = { kind: 'ability', ability: ab, owner: entity.controller, entityName: stats.name }; }}
                >
                  <i class="ra ra-lightning"></i>
                  <div class="ab-body">
                    <span class="ab-name">{ab.name}</span>
                    {#if ab.description}
                      <span class="ab-desc">{ab.description}</span>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
          {#if creature && creature.remaining_energy <= 0}
            <p class="exhausted-note">No energy — cannot act this turn</p>
          {/if}
        </div>

      {:else if inspected?.kind === 'passive'}
        {@const p     = inspected.passive}
        {@const owner = inspected.owner}
        <div class="insp">
          <div class="insp-glow" style="--ec:{p.color}"></div>
          <div class="insp-ring" style="border-color:{p.color}55; background:{p.color}0d">
            <i class="ra {p.icon}" style="color:{p.color}"></i>
          </div>
          <h2 class="insp-name">{p.name}</h2>
          <span class="controller-badge" style="color:{playerColor(owner)}">
            Player {owner} — {p.kind === 'buff' ? 'Buff' : 'Curse'}
          </span>
          <div class="divider"><span>EFFECT</span></div>
          <p class="passive-desc">{p.description}</p>
        </div>

      {:else if inspected?.kind === 'ability'}
        {@const ab    = inspected.ability}
        {@const owner = inspected.owner}
        {@const color = '#c0a040'}
        <div class="insp">
          <div class="insp-glow" style="--ec:{color}"></div>
          <div class="insp-ring" style="border-color:{color}55; background:{color}0d">
            <i class="ra ra-lightning" style="color:{color}"></i>
          </div>
          <h2 class="insp-name">{ab.name}</h2>
          <span class="controller-badge" style="color:{playerColor(owner)}">
            Player {owner} — {inspected.entityName}
          </span>
          <div class="divider"><span>EFFECT</span></div>
          <p class="passive-desc">{ab.description ?? 'No description.'}</p>
        </div>

      {:else if inspected?.kind === 'attribute'}
        {@const attr  = inspected.attribute}
        {@const owner = inspected.owner}
        {@const am    = ATTRIBUTE_META[attr]}
        <div class="insp">
          <div class="insp-glow" style="--ec:{am.color}"></div>
          <div class="insp-ring" style="border-color:{am.color}55; background:{am.color}0d">
            <i class="ra {am.icon}" style="color:{am.color}"></i>
          </div>
          <h2 class="insp-name">{attr}</h2>
          <span class="controller-badge" style="color:{playerColor(owner)}">
            Player {owner} — {inspected.entityName}
          </span>
          <div class="divider"><span>EFFECT</span></div>
          <p class="passive-desc">{am.description}</p>
        </div>

      {:else}
        <div class="insp-empty">
          <i class="ra ra-scroll"></i>
          <p>Click a creature on the board or a card in hand to inspect it.</p>
        </div>
      {/if}
    </aside>

    <!-- ARENA -->
    <main class="arena">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="game-grid" ondragend={resetDrag}>
        {#each viewOrder as i (i)}
          {@const cell       = grid[i]}
          {@const entity     = cell?.entity ?? null}
          {@const entityType = entity?.kind ?? null}
          {@const meta       = cell ? uiMeta(cell.entity.name) : null}
          {@const canDrag    =
              cell &&
              cell.controller === turn &&
              myTurn &&
              entityType == "creature" &&
              (entity as Creature).remaining_energy > 0
          }
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class={cellClass(i)}
            aria-label={cell ? cell.entity.name : (i === CASTLE_IDX ? 'Castle' : 'Empty')}
            draggable={canDrag}
            ondragstart={e => boardDragStart(e, i)}
            ondragover={e => onDragOver(e, i)}
            ondrop={e => onDrop(e, i)}
            onclick={() => { if (cell) inspected = { kind: 'board', entity: cell }; }}
          >
            <span class="coord">{Math.floor(i / 5)},{i % 5}</span>

            {#if !cell && i === CASTLE_IDX}
              <i class="ra ra-tower castle-icon"></i>
            {/if}

            {#if cell && meta}
              <i
                class="ra {meta.icon} ent-icon"
                class:exhausted={entityType == "creature" && (entity as Creature).remaining_energy <= 0}
                style="color:{meta.color}; filter:drop-shadow(0 0 8px {meta.color}66)"
              ></i>
              <div class="hp-bar-wrap">
                <div
                  class="hp-bar"
                  style="width:{Math.max(0,(cell.entity.remaining_hp / cell.entity.base_hp) * 100)}%; background:{meta.color}bb"
                ></div>
              </div>
              {#if entityType == "creature"}
                {@const c = entity as Creature}
                <span class="atk-badge">{c.attack}</span>
                <div class="energy-pips">
                  {#each { length: c.base_energy } as _, e}
                    <span class="pip" class:pip-spent={e >= c.remaining_energy}></span>
                  {/each}
                </div>
              {:else if entityType == "construction"}
                <span class="construction-marker">🏗</span>
              {/if}
            {:else if !cell && dragMode}
              <span class="drop-hint"></span>
            {/if}
          </div>
        {/each}
      </div>
    </main>

    <!-- RIGHT SIDEBAR: Log only -->
    <aside class="sidebar-right">
      <div class="divider log-divider"><span>LOG</span></div>
      <ul class="log-list">
        {#each gameLog as entry}
          <li>{entry}</li>
        {/each}
      </ul>
    </aside>

  </div>

  <!-- HAND FOOTER -->
  <footer class="hand-area">
    {#each cardKindVariants as k}
      <div class="hand-section">
        <div class="hand-section-label">
          {#if k === 'creature'}⚔{:else if k === 'construction'}🏗{:else}⚡{/if}
        </div>
        <div class="hand-scroll">
          {#each hands[turn].cards[k] as card, i (i)}
            {#if !card}
              <div class="hand-card hand-card-spent" aria-label="Spent slot">
                <i class="ra ra-cancel"></i>
                <span class="card-label">Spent</span>
              </div>
            {:else}
              {@const meta       = uiMeta(card.name)}
              {@const affordable = players[turn].mana >= card.cost}
              <div
                class="hand-card"
                class:unaffordable={!affordable}
                class:casting-card={k === 'casting'}
                class:casting-card-no-target={k === 'casting' && (card as CastingTemplate).targeting.kind === 'none'}
                draggable={!winner && affordable}
                role="button"
                tabindex="0"
                aria-label="Play {card.name} for {card.cost} mana"
                ondragstart={e => handDragStart(e, i, k)}
                ondragend={resetDrag}
                onclick={() => { inspected = { kind: 'hand', card }; }}
                onkeydown={e => e.key === 'Enter' && (inspected = { kind: 'hand', card })}
              >
                <span class="rarity-bar" style="background:{RARITY_COLORS[meta.rarity]}"></span>
                <div class="card-cost"><i class="ra ra-crystal-ball"></i>{card.cost}</div>
                {#if myTurn && !winner}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <button
                    class="reroll-btn"
                    type="button"
                    title="Reroll ({REROLL_COST} mana)"
                    disabled={players[turn].mana < REROLL_COST}
                    onmousedown={e => e.stopPropagation()}
                    ondragstart={e => e.preventDefault()}
                    onclick={e => rerollSlot(i, k, e)}
                  >
                    <i class="ra ra-recycle"></i>
                    <span class="reroll-cost">{REROLL_COST}</span>
                  </button>
                {/if}
                <i class="ra {meta.icon}" style="color:{meta.color}"></i>
                <span class="card-label">{card.name}</span>
                {#if k === 'creature'}
                  {@const c = card as CreatureTemplate}
                  <div class="card-stats">
                    <span title="Attack">{c.attack}⚔</span>
                    <span title="HP">{c.hp}♥</span>
                  </div>
                {:else if k === 'construction'}
                  {@const c = card as ConstructionTemplate}
                  <div class="card-stats">
                    <span title="HP">{c.hp}♥</span>
                  </div>
                {:else}
                  <div class="card-stats casting-tag">instant</div>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {/each}
  </footer>
</div>

<!-- ─── Styles ────────────────────────────────────────────────────────────── -->
<style>
  :root {
    /* ── Surface / background tokens (darkest → lightest) ─────────── */
    --bg-0: #080710;           /* page / arena far background */
    --bg-1: #0d0a1a;           /* sidebars, hand, header-adjacent */
    --bg-2: #12102a;           /* cards, chips, grid frame */
    --bg-3: #1a1735;           /* elevated rows, stat rows */
    --bg-4: #272345;           /* hover states */

    /* ── Border tokens ───────────────────────────────────────────── */
    --border-1: #332d54;
    --border-2: #4a4376;
    --border-strong: #6a5faa;

    /* ── Text tokens (WCAG-friendly against bg-0/bg-1) ───────────── */
    --text-1: #ffffff;         /* highest contrast — titles */
    --text-2: #f1ead6;         /* primary body text */
    --text-3: #d0c8b4;         /* secondary body text */
    --text-4: #a69f8a;         /* tertiary / labels (still ~AA) */
    --text-muted: #8a8375;     /* least contrast still legible */
    --text-inverse: #0a0815;

    /* ── Accent text colors (bright enough for dark bg) ──────────── */
    --accent-gold:   #ffd65c;
    --accent-amber:  #ffb040;
    --accent-blue:   #9cc8ff;
    --accent-red:    #ff8a78;
    --accent-green:  #7ae29a;
    --accent-purple: #c9a8ff;
    --accent-rose:   #ff8aa8;

    /* ── Player colors ───────────────────────────────────────────── */
    --player-a: #9cc8ff;
    --player-b: #ff9a88;

    /* ── Rarity accents ──────────────────────────────────────────── */
    --rarity-common:    #b8b0a0;
    --rarity-uncommon:  #7ae29a;
    --rarity-rare:      #9cc8ff;
    --rarity-legendary: #ffc870;

    /* ── Type scale (base 22px → bigger overall) ─────────────────── */
    --t-xs:   0.9rem;   /* smallest — coord, pips */
    --t-sm:   1.0rem;   /* labels, meta chips */
    --t-md:   1.1rem;   /* body */
    --t-lg:   1.25rem;  /* section titles */
    --t-xl:   1.5rem;   /* names, badges */
    --t-2xl:  1.9rem;   /* modal titles */
    --t-icon-sm: 1.1rem;
    --t-icon-md: 1.6rem;
    --t-icon-lg: 2.4rem;
    --t-icon-xl: 3.4rem;

    /* ── Fonts ───────────────────────────────────────────────────── */
    --font-body:    'Crimson Pro', Georgia, serif;
    --font-display: 'Cinzel', serif;

    /* ── Shadows ─────────────────────────────────────────────────── */
    --shadow-hdr:  0 2px 20px rgba(0,0,0,0.6);
    --shadow-card: 0 16px 36px rgba(0,0,0,0.75);
    --shadow-grid: 0 28px 80px rgba(0,0,0,0.9);

    /* ── Status colors ───────────────────────────────────────────── */
    --hp-low:  #ff5a5a;
    --hp-high: #66d67d;
    --danger:  #ff7070;
    --warn:    #ffc040;
  }

  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    height: 100%; overflow: hidden;
    background: var(--bg-0); color: var(--text-2);
    font-family: var(--font-body);
    font-size: clamp(14px, 0.75vw + 0.55vh, 20px);
    line-height: 1.5;
  }

  /* ── Shell ── */
  .app {
    height: 100vh; width: 100vw; overflow: hidden;
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "hdr  hdr  hdr"
      "sl   ar   sr"
      "sl   hand sr";
    min-height: 0;
  }

  /* ── Header ── */
  .hdr {
    grid-area: hdr;
    height: 3.4rem; flex-shrink: 0;
    display: flex; align-items: center; gap: 1.3rem; padding: 0 1.5rem;
    background: var(--bg-1); border-bottom: 1px solid var(--border-1);
    box-shadow: var(--shadow-hdr); z-index: 10;
  }
  .hdr-brand {
    display: flex; align-items: center; gap: 0.6rem;
    font-family: var(--font-display); font-size: var(--t-xl); font-weight: 700;
    color: var(--accent-gold); letter-spacing: 0.06em; flex-shrink: 0;
  }
  .hdr-turn {
    flex: 1; display: flex; align-items: center; gap: 1rem;
    font-family: var(--font-display); font-size: var(--t-md); letter-spacing: 0.04em;
    color: var(--text-2);
  }
  .active-pip { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .stat-chip {
    display: flex; align-items: center; gap: 0.35rem; font-size: var(--t-md); font-weight: 600;
    padding: 0.3rem 0.8rem; border-radius: 5px; background: var(--bg-2); border: 1px solid var(--border-1);
    color: var(--text-2);
  }
  .stat-chip i { font-size: var(--t-icon-sm); }
  .mana-chip { color: var(--accent-blue); }
  .hold-chip { color: var(--accent-amber); }
  .btn-end-turn {
    margin-left: auto; background: var(--bg-2); border: 1px solid var(--border-2); border-radius: 6px;
    color: var(--text-1); font-family: var(--font-display); font-size: var(--t-md);
    letter-spacing: 0.1em; padding: 0.45rem 1.2rem; cursor: pointer; font-weight: 600;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .btn-end-turn:hover { background: var(--bg-4); border-color: var(--border-strong); color: var(--text-1); }
  .winner-badge { font-family: var(--font-display); font-size: var(--t-xl); font-weight: 700; letter-spacing: 0.08em; color: var(--accent-gold); }
  .btn-restart {
    margin-left: 1rem; background: var(--bg-3); border: 1px solid var(--border-strong); border-radius: 6px;
    color: var(--text-1); font-family: var(--font-display); font-size: var(--t-md); padding: 0.45rem 1.2rem; cursor: pointer;
    font-weight: 600;
  }

  /* ── Body: grid layout passthrough ── */
  .body { display: contents; }

  /* ── Left Sidebar: Inspector ── */
  .sidebar-left {
    grid-area: sl;
    width: 22vw; min-width: 12rem; height: 100%;
    background: var(--bg-1); border-right: 1px solid var(--border-1);
    overflow-y: auto; display: flex; flex-direction: column;
    scrollbar-width: thin; scrollbar-color: var(--border-2) transparent;
    color: var(--text-2);
  }

  /* ── Right Sidebar: Log ── */
  .sidebar-right {
    grid-area: sr;
    width: 18vw; min-width: 11rem; height: 100%;
    background: var(--bg-1); border-left: 1px solid var(--border-1);
    overflow-y: auto; display: flex; flex-direction: column;
    padding: 1rem 1rem 1.3rem;
    scrollbar-width: thin; scrollbar-color: var(--border-2) transparent;
    color: var(--text-3);
  }

  /* ── Inspector shared ── */
  .insp {
    position: relative; padding: 1.5rem 1.2rem 1.7rem;
    display: flex; flex-direction: column; align-items: center; gap: 0.65rem; overflow: hidden;
  }
  .insp-glow {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--ec) 20%, transparent) 0%, transparent 65%);
    pointer-events: none;
  }
  .insp-ring {
    width: 5.5rem; height: 5.5rem; border-radius: 50%; border: 2px solid;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--t-icon-xl); position: relative; z-index: 1;
  }
  .insp-name { font-family: var(--font-display); font-size: var(--t-xl); font-weight: 700; text-align: center; color: var(--text-1); }
  .insp-cost { font-size: var(--t-md); color: var(--accent-blue); display: flex; align-items: center; gap: 0.35rem; font-weight: 600; }
  .rarity-pill { font-size: var(--t-sm); text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; }
  .controller-badge { font-family: var(--font-display); font-size: var(--t-md); font-weight: 700; }
  .insp-flavor {
    font-size: var(--t-md); font-style: italic; color: var(--text-4); text-align: center; line-height: 1.55;
    border-left: 3px solid var(--border-2); padding-left: 0.7rem; width: 100%;
  }
  .kind-badge {
    font-size: var(--t-sm); font-family: var(--font-display); letter-spacing: 0.08em; font-weight: 700;
    padding: 0.2rem 0.7rem; border-radius: 5px; border: 1px solid;
  }
  .casting-badge      { color: var(--accent-gold);  border-color: color-mix(in srgb, var(--accent-gold) 40%, transparent); background: color-mix(in srgb, var(--accent-gold) 10%, transparent); }
  .construction-badge { color: var(--accent-green); border-color: color-mix(in srgb, var(--accent-green) 40%, transparent); background: color-mix(in srgb, var(--accent-green) 10%, transparent); }
  .creature-badge     { color: var(--accent-red);   border-color: color-mix(in srgb, var(--accent-red) 40%, transparent); background: color-mix(in srgb, var(--accent-red) 10%, transparent); }
  .casting-hint { font-size: var(--t-sm); font-style: italic; color: var(--text-4); text-align: center; line-height: 1.55; }
  .divider { width: 100%; display: flex; align-items: center; gap: 0.55rem; margin: 0.3rem 0 0.2rem; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border-1); }
  .divider span { font-family: var(--font-display); font-size: var(--t-sm); letter-spacing: 0.14em; color: var(--text-3); white-space: nowrap; font-weight: 700; }
  .stat-list { width: 100%; list-style: none; display: flex; flex-direction: column; gap: 0.32rem; }
  .stat-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.4rem 0.75rem; background: var(--bg-2); border: 1px solid var(--border-1); border-radius: 6px;
  }
  .stat-k { font-family: var(--font-display); font-size: var(--t-sm); letter-spacing: 0.08em; color: var(--text-3); text-transform: uppercase; font-weight: 700; }
  .stat-v { font-size: var(--t-lg); color: var(--text-1); font-weight: 700; }
  .hp-val { color: color-mix(in srgb, var(--hp-low) calc((1 - var(--hpc)) * 100%), var(--hp-high) calc(var(--hpc) * 100%)); }
  .ability-row { gap: 0.6rem; justify-content: flex-start; align-items: flex-start; }
  .ability-row i { color: var(--accent-gold); font-size: var(--t-md); margin-top: 3px; }
  .ab-body { display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .ab-name { font-size: var(--t-md); color: var(--text-1); font-weight: 600; }
  .ab-desc { font-size: var(--t-sm); color: var(--text-3); line-height: 1.4; font-style: italic; }
  .ability-clickable { cursor: pointer; border-radius: 6px; transition: background 0.15s; }
  .ability-clickable:hover { background: color-mix(in srgb, var(--accent-gold) 14%, transparent); }
  .attr-list { list-style: none; padding: 0; margin: 0.3rem 0 0.6rem; display: flex; flex-wrap: wrap; gap: 7px; }
  .attr-chip {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 12px; border: 1px solid; border-radius: 999px;
    font-size: var(--t-sm); color: var(--text-1); cursor: pointer; font-weight: 600;
    transition: transform 0.12s, filter 0.15s;
  }
  .attr-chip:hover { transform: translateY(-1px); filter: brightness(1.25); }
  .attr-chip i { font-size: var(--t-icon-sm); }
  .exhausted-note { font-size: var(--t-md); color: var(--danger); font-style: italic; margin-top: 0.4rem; font-weight: 600; }
  .insp-empty {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1rem; padding: 2rem 1.3rem; text-align: center;
  }
  .insp-empty i { font-size: var(--t-icon-xl); color: var(--border-2); }
  .insp-empty p { font-size: var(--t-md); font-style: italic; line-height: 1.6; color: var(--text-4); }

  /* ── Log (right sidebar) ── */
  .log-divider { margin-bottom: 0.6rem; }
  .log-list { list-style: none; display: flex; flex-direction: column; gap: 0.25rem; }
  .log-list li {
    font-size: var(--t-md); color: var(--text-3); line-height: 1.5;
    border-bottom: 1px solid var(--border-1); padding: 0.2rem 0;
  }
  .log-list li:first-child { color: var(--text-1); font-weight: 600; }

  /* ── Arena ── */
  .arena {
    grid-area: ar;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    min-width: 0; min-height: 0;
    background: radial-gradient(ellipse at 50% 44%, var(--bg-2) 0%, var(--bg-0) 62%);
    position: relative;
  }
  .arena::after {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 50%, transparent 38%, var(--bg-0) 100%);
    pointer-events: none;
  }

  .game-grid {
    position: relative; z-index: 1;
    display: grid;
    grid-template-columns: repeat(5, min(calc((56vw - 48px) / 5), calc((100vh - 3.4rem - 8.5rem - 48px) / 5)));
    grid-template-rows:    repeat(5, min(calc((56vw - 48px) / 5), calc((100vh - 3.4rem - 8.5rem - 48px) / 5)));
    gap: 6px; background: var(--bg-1); padding: 12px; border-radius: 12px;
    border: 1px solid var(--border-1);
    box-shadow: 0 0 0 1px var(--bg-0), var(--shadow-grid);
  }

  /* ── Cell ── */
  .cell {
    position: relative; background: linear-gradient(140deg, var(--bg-2) 0%, var(--bg-1) 100%);
    border: 1px solid var(--border-1); border-radius: 8px; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    transition: border-color 0.15s, background 0.15s, transform 0.12s;
    user-select: none; overflow: hidden;
  }
  .cell:hover { background: linear-gradient(140deg, var(--bg-3) 0%, var(--bg-2) 100%); border-color: var(--border-strong); transform: scale(1.05); z-index: 5; }
  .cell.drag-over { border-color: var(--accent-gold) !important; background: linear-gradient(140deg, var(--bg-3) 0%, var(--bg-2) 100%) !important; transform: scale(1.07) !important; z-index: 6; box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-gold) 45%, transparent); }
  .cell.cell-lifting { opacity: 0.22; transform: scale(0.94) !important; border-style: dashed !important; }
  .cell.castle-cell { background: linear-gradient(140deg, var(--bg-3) 0%, var(--bg-2) 100%) !important; border-color: var(--accent-amber); }
  .cell.castle-cell::before { content: ''; position: absolute; inset: 0; border-radius: 8px; box-shadow: inset 0 0 22px color-mix(in srgb, var(--accent-amber) 16%, transparent); pointer-events: none; }
  .cell.cell-a { border-color: color-mix(in srgb, var(--player-a) 50%, var(--border-1)); }
  .cell.cell-b { border-color: color-mix(in srgb, var(--player-b) 50%, var(--border-1)); }
  .cell.play-row-a { outline: 2px solid var(--player-a); outline-offset: -2px; box-shadow: 0 0 10px color-mix(in srgb, var(--player-a) 40%, transparent); }
  .cell.play-row-b { outline: 2px solid var(--player-b); outline-offset: -2px; box-shadow: 0 0 10px color-mix(in srgb, var(--player-b) 40%, transparent); }
  .cell.casting-target {
    border-color: color-mix(in srgb, var(--accent-gold) 55%, transparent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-gold) 35%, transparent);
  }
  .cell.casting-legal {
    border-color: var(--accent-green) !important;
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent-green) 50%, transparent);
  }
  .cell.casting-illegal {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: inset 0 0 12px color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .cell.casting-any {
    border-color: color-mix(in srgb, var(--accent-purple) 55%, transparent) !important;
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-purple) 40%, transparent);
  }

  .coord { position: absolute; top: 4px; left: 6px; font-size: var(--t-xs); color: var(--text-muted); font-family: var(--font-display); pointer-events: none; font-weight: 600; }
  .castle-icon { font-size: var(--t-icon-xl); color: var(--accent-amber); opacity: 0.5; pointer-events: none; }

  .ent-icon { font-size: var(--t-icon-xl); line-height: 1; pointer-events: none; transition: transform 0.2s; }
  .cell:hover .ent-icon { transform: scale(1.1); }
  .ent-icon.exhausted { opacity: 0.4; filter: grayscale(70%) !important; }

  .hp-bar-wrap { position: absolute; bottom: 16px; left: 8px; right: 8px; height: 5px; background: var(--bg-3); border-radius: 2px; }
  .hp-bar { height: 100%; border-radius: 2px; transition: width 0.3s; }

  .atk-badge { position: absolute; top: 4px; right: 6px; font-size: var(--t-sm); font-family: var(--font-display); font-weight: 800; color: var(--accent-amber); line-height: 1; }
  .construction-marker { position: absolute; top: 4px; right: 6px; font-size: var(--t-sm); opacity: 0.75; }

  .energy-pips { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
  .pip { width: 9px; height: 9px; border-radius: 50%; background: var(--accent-green); box-shadow: 0 0 5px color-mix(in srgb, var(--accent-green) 55%, transparent); transition: background 0.2s, box-shadow 0.2s; }
  .pip.pip-spent { background: var(--bg-3); box-shadow: none; }

  .drop-hint { width: 30px; height: 30px; border-radius: 50%; border: 1px dashed var(--border-2); animation: pulse-ring 1.5s ease-in-out infinite; }
  @keyframes pulse-ring { 0%, 100% { opacity: 0.2; transform: scale(0.88); } 50% { opacity: 0.6; transform: scale(1.1); } }

  /* ── Hand area ── */
  .hand-area {
    grid-area: hand;
    height: 8.5rem; min-width: 0;
    background: var(--bg-1); border-top: 1px solid var(--border-1);
    box-shadow: 0 -8px 32px rgba(0,0,0,0.6);
    display: flex; align-items: stretch; gap: 0; padding: 0; z-index: 5; overflow: hidden;
  }
  .hand-section {
    display: flex; align-items: center; flex: 1; border-right: 1px solid var(--border-1);
    padding: 0 0.5rem;
  }
  .hand-section:last-child { border-right: none; }
  .hand-section-label {
    font-size: var(--t-xl); padding: 0 0.45rem; flex-shrink: 0; color: var(--text-3);
  }
  .hand-scroll {
    display: flex; gap: 0.7rem; overflow-x: auto; flex: 1;
    padding: 0.55rem 0; scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; align-items: center;
  }
  .hand-card {
    position: relative; width: 6.5rem; height: 7.5rem; flex-shrink: 0;
    background: linear-gradient(160deg, var(--bg-2) 0%, var(--bg-1) 100%);
    border: 1px solid var(--border-1); border-radius: 8px;
    cursor: grab; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; transition: border-color 0.14s, transform 0.12s; overflow: hidden; outline: none;
    color: var(--text-2);
  }
  .hand-card:hover { border-color: var(--border-strong); transform: translateY(-10px) scale(1.05); z-index: 5; box-shadow: var(--shadow-card); }
  .hand-card.unaffordable { opacity: 0.42; cursor: not-allowed; }
  .hand-card.hand-card-spent {
    opacity: 0.35; cursor: not-allowed;
    background: repeating-linear-gradient(
      45deg,
      var(--bg-1) 0 8px,
      var(--bg-2) 8px 16px
    );
    border-style: dashed; border-color: var(--border-1);
    color: var(--text-muted);
    pointer-events: none;
  }
  .hand-card.hand-card-spent i { color: var(--text-muted); font-size: var(--t-icon-md); }
  .hand-card.hand-card-spent .card-label { color: var(--text-muted); }
  .hand-card:active { cursor: grabbing; }
  .hand-card i { font-size: var(--t-icon-lg); pointer-events: none; transition: transform 0.2s; }
  .hand-card:hover i { transform: scale(1.1); }
  .hand-card.casting-card { background: linear-gradient(160deg, var(--bg-2) 0%, var(--bg-1) 100%); border-color: color-mix(in srgb, var(--accent-gold) 35%, var(--border-1)); }
  .hand-card.casting-card:hover { border-color: var(--accent-gold); box-shadow: 0 16px 36px color-mix(in srgb, var(--accent-gold) 18%, transparent); }
  .hand-card.casting-card-no-target {
    background: linear-gradient(160deg, var(--bg-3) 0%, var(--bg-1) 100%);
    border-color: color-mix(in srgb, var(--accent-purple) 35%, var(--border-1));
    border-style: dashed;
  }
  .hand-card.casting-card-no-target:hover { border-color: var(--accent-purple); box-shadow: 0 16px 36px color-mix(in srgb, var(--accent-purple) 22%, transparent); }
  .card-cost { position: absolute; top: 6px; left: 8px; font-size: var(--t-sm); font-family: var(--font-display); color: var(--accent-blue); display: flex; align-items: center; gap: 3px; font-weight: 700; }
  .card-cost i { font-size: var(--t-sm); }
  .reroll-btn {
    position: absolute; top: 5px; right: 5px; z-index: 2;
    display: flex; align-items: center; gap: 3px;
    padding: 3px 7px; font-size: var(--t-xs); font-family: var(--font-display); font-weight: 700;
    color: var(--accent-gold); background: color-mix(in srgb, var(--bg-0) 85%, transparent); border: 1px solid var(--border-2);
    border-radius: 5px; cursor: pointer; line-height: 1;
    transition: background 0.15s, transform 0.12s, border-color 0.15s;
  }
  .reroll-btn i { font-size: var(--t-sm); }
  .reroll-btn:hover:not(:disabled) { background: var(--bg-3); border-color: var(--accent-gold); transform: scale(1.1); }
  .reroll-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .reroll-cost { font-size: var(--t-xs); }
  .card-label { font-size: var(--t-sm); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-1); text-align: center; pointer-events: none; line-height: 1.3; padding: 0 4px; font-weight: 700; }
  .card-stats { display: flex; gap: 9px; font-size: var(--t-sm); color: var(--text-2); pointer-events: none; font-weight: 600; }
  .casting-tag { color: var(--accent-gold); font-style: italic; font-size: var(--t-sm); font-weight: 600; }
  .rarity-bar { position: absolute; top: 0; left: 0; right: 0; height: 3px; border-radius: 8px 8px 0 0; opacity: 0.9; }

  /* ── Pact selection overlay ───────────────────────────────────────────── */
  .pact-overlay {
    position: fixed; inset: 0; z-index: 100;
    background: rgba(6,4,12,0.88); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    padding: 1.2rem;
    overflow-y: auto;
  }
  .pact-modal {
    background: linear-gradient(160deg, var(--bg-2) 0%, var(--bg-0) 100%);
    border: 1px solid var(--border-strong); border-radius: 14px;
    max-width: min(1120px, calc(100vw - 2rem));
    width: 100%;
    max-height: calc(100vh - 2rem);
    padding: 1.4rem 1.5rem;
    box-shadow: 0 24px 60px rgba(0,0,0,0.75);
    color: var(--text-2);
    display: flex; flex-direction: column; gap: 0.6rem;
    overflow: hidden;
  }
  .pact-title { font-family: var(--font-display); color: var(--accent-gold); text-align: center; margin: 0; font-size: var(--t-xl); letter-spacing: 0.08em; font-weight: 700; }
  .pact-sub { color: var(--text-3); text-align: center; margin: 0 0 0.4rem; font-style: italic; font-size: var(--t-sm); }
  .pact-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
    overflow-y: auto;
    padding-right: 4px;
  }
  .pact-card {
    background: linear-gradient(180deg, var(--bg-3) 0%, var(--bg-1) 100%);
    border: 1px solid var(--border-2); border-radius: 10px;
    padding: 0.65rem; cursor: pointer;
    display: flex; flex-direction: column; gap: 0.4rem;
    transition: border-color 0.15s, transform 0.12s;
    min-width: 0;
  }
  .pact-card:hover { border-color: var(--accent-gold); transform: translateY(-2px); box-shadow: 0 8px 20px color-mix(in srgb, var(--accent-gold) 22%, transparent); }
  .pact-half { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0.45rem 0.3rem; border-radius: 6px; }
  .pact-half i { font-size: var(--t-lg); margin-bottom: 0.2rem; }
  .pact-buff { background: color-mix(in srgb, var(--accent-green) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-green) 30%, transparent); }
  .pact-curse { background: color-mix(in srgb, var(--accent-red) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-red) 30%, transparent); }
  .pact-half-name { font-family: var(--font-display); font-size: var(--t-sm); color: var(--text-1); font-weight: 700; line-height: 1.25; }
  .pact-half-desc { font-size: var(--t-xs); color: var(--text-3); line-height: 1.35; margin-top: 0.2rem; }
  .pact-divider { text-align: center; color: var(--text-4); font-size: var(--t-sm); }

  /* ── Pact corner indicators ───────────────────────────────────────────── */
  .pact-corners { display: flex; gap: 0.9rem; align-items: center; }
  .pact-corner {
    display: flex; align-items: center; gap: 0.35rem;
    background: var(--bg-2);
    border: 1px solid var(--border-2); border-radius: 8px;
    padding: 0.3rem 0.6rem;
  }
  .pact-corner-label { font-family: var(--font-display); font-size: var(--t-sm); font-weight: 700; color: var(--text-2); }
  .pact-corner-icon { font-size: var(--t-icon-sm); }
  .pact-corner-clickable { cursor: pointer; transition: transform 0.12s, filter 0.12s; }
  .pact-corner-clickable:hover { transform: scale(1.25); filter: drop-shadow(0 0 6px currentColor); }
  .passive-desc { font-size: var(--t-md); color: var(--text-2); line-height: 1.5; text-align: center; padding: 0 0.6rem; }
  .pact-corner-slash { color: var(--text-4); }
</style>
