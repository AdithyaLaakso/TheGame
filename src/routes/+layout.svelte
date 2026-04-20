<svelte:head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rpg-awesome@0.2.0/css/rpg-awesome.min.css" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,400&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
  import type { Entity, PlayerId, CreatureTemplate, ConstructionTemplate, CardType, Playable } from './Game';
  import {
    GameState, Creature, Deck,
    creatures, constructions, castings,
    index_to_coords, cardKindVariants
  } from './Game';

  // ── Constants ───────────────────────────────────────────────────────────────
  const CASTLE_IDX      = 12;
  const CASTLE_HOLD_WIN = 3;

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

  let game_state = $state(new GameState(makeDeck()));

  let rev = $state(0);

  let grid    = $derived([...game_state.grid]);
  let turn    = $derived(game_state.turn);
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
    | { kind: 'hand';  card:   Playable }
    | { kind: 'board'; entity: Entity           }
    | null;

  let inspected: Inspected = $state(null);

  let inspectedLive: Inspected = $derived.by(() => {
    rev;
    if (!inspected) return null;
    if (inspected.kind === 'hand') return inspected;
    const fresh = game_state.getEntity(inspected.entity.id);
    return fresh ? { kind: 'board', entity: fresh } : null;
  });

  // ── Drag state ───────────────────────────────────────────────────────────────
  type DragMode = 'hand' | 'move' | 'attack';
  let dragMode:     DragMode | null = $state(null);
  let dragCardIdx:  number | null   = null;
  /** The CardType of the card being dragged from hand. */
  let dragCardKind: CardType | null = null;
  let dragFromId:   number | null   = null;
  let dragOverIdx:  number | null   = $state(null);

  function handDragStart(e: DragEvent, idx: number, k: CardType) {
    if (winner) { e.preventDefault(); return; }
    const card = hands[turn].cards[k][idx];
    if (!card || card.cost > players[turn].mana) { e.preventDefault(); return; }
    dragMode     = 'hand';
    dragCardIdx  = idx;
    dragCardKind = k;          // ← store the hand card's type, not the target's
    e.dataTransfer!.effectAllowed = 'copy';
  }

  function boardDragStart(e: DragEvent, cellIdx: number) {
    if (winner) { e.preventDefault(); return; }
    const entity = grid[cellIdx];
    if (!entity || entity.controller !== turn) { e.preventDefault(); return; }
    const creature = entity.entity instanceof Creature ? entity.entity : null;
    if (!creature || creature.energy_remaining <= 0) { e.preventDefault(); return; }
    dragMode   = 'move';
    dragFromId = entity.id;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function onDragOver(e: DragEvent, cellIdx: number) {
    e.preventDefault();
    dragOverIdx = cellIdx;
    const targetEntity = grid[cellIdx];

    if (dragMode === 'hand') {
      if (dragCardKind === 'casting') {
        // Castings may target any cell — occupied or empty (onPlay decides validity)
        e.dataTransfer!.dropEffect = 'copy';
      } else {
        // Creatures / constructions need an empty cell
        e.dataTransfer!.dropEffect = targetEntity ? 'none' : 'copy';
      }
    } else {
      // Board piece: attack if enemy present, move if empty
      dragMode = (targetEntity && targetEntity.controller !== turn) ? 'attack' : 'move';
      e.dataTransfer!.dropEffect = 'move';
    }
  }

  function onDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    if (winner) { resetDrag(); return; }

    const toCoords    = index_to_coords(toIdx);
    const targetEntity = grid[toIdx];

    if (dragMode === 'hand' && dragCardIdx !== null && dragCardKind !== null) {
      // ── Play from hand ────────────────────────────────────
      const result = game_state.play(dragCardIdx, toCoords, dragCardKind);
      if (result === 'not_enough_mana') game_state.log.push('Not enough mana!');
      if (result === 'invalid_coords')  game_state.log.push('Cannot place there.');

    } else if ((dragMode === 'move' || dragMode === 'attack') && dragFromId !== null) {
      // ── Move / attack from board ──────────────────────────
      if (targetEntity && targetEntity.controller !== turn) {
        game_state.attack(dragFromId, targetEntity.id);
      } else if (!targetEntity) {
        game_state.move(dragFromId, toCoords);
      }
    }

    resetDrag();
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
    const entity = grid[i];
    if (entity) {
      parts.push(entity.controller === 'A' ? 'cell-a' : 'cell-b');
      if (dragFromId !== null && entity.id === dragFromId) parts.push('cell-lifting');
    }
    // Highlight valid casting targets when dragging a casting card
    if (dragMode === 'hand' && dragCardKind === 'casting' && entity) {
      parts.push('casting-target');
    }
    return parts.join(' ');
  }

  function restart() {
    game_state = new GameState(makeDeck());
    winner     = null;
    inspected  = null;
    resetDrag();
  }
</script>

<!-- ─── Markup ───────────────────────────────────────────────────────────── -->
<div class="app">
  <!-- HEADER -->
  <header class="hdr">
    <div class="hdr-brand">
      <i class="ra ra-castle-emblem"></i>
      <span>Castle Hold</span>
    </div>

    <div class="hdr-turn">
      {#if winner}
        <span class="winner-badge" style="color:{playerColor(winner)}">⚔ Player {winner} wins!</span>
        <button class="btn-restart" onclick={restart}>New game</button>
      {:else}
        <span class="active-pip" style="background:{playerColor(turn)}"></span>
        <span>Player <strong>{turn}</strong> — Turn {turnNum}</span>
        <span class="stat-chip mana-chip">
          <i class="ra ra-crystal-ball"></i>{players[turn].mana} mana
        </span>
        <span class="stat-chip hold-chip" title="Castle hold turns">
          <i class="ra ra-tower"></i>{players[turn].castleHolds}/{CASTLE_HOLD_WIN}
        </span>
        <button class="btn-end-turn" onclick={endTurn}>End Turn →</button>
      {/if}
    </div>
  </header>

  <!-- BODY: left inspector | arena | right log -->
  <div class="body">

    <!-- LEFT SIDEBAR: Inspector only -->
    <aside class="sidebar-left">
      {#if inspectedLive?.kind === 'hand'}
        {@const card = inspectedLive.card}
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
            <p class="casting-hint">Drag onto any board entity to target it.</p>
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
                      <span class="ab-name">{ab.name}</span>
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
                      <span class="ab-name">{ab.name}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
          {/if}
        </div>
      {:else if inspectedLive?.kind === 'board'}
        {@const entity   = inspectedLive.entity}
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
                <span class="stat-v" style="color:{creature.energy_remaining > 0 ? '#80d090' : '#d05050'}">
                  {creature.energy_remaining}/{creature.base_energy}
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
          {#if stats.abilities.length > 0}
            <div class="divider"><span>ABILITIES</span></div>
            <ul class="stat-list">
              {#each stats.abilities as ab}
                <li class="stat-row ability-row">
                  <i class="ra ra-lightning"></i>
                  <span class="ab-name">{ab.name}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if creature && creature.energy_remaining <= 0}
            <p class="exhausted-note">No energy — cannot act this turn</p>
          {/if}
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
        {#each grid as cell, i}
          {@const entity     = cell?.entity ?? null}
          {@const entityType = entity?.kind ?? null}
          {@const meta       = cell ? uiMeta(cell.entity.name) : null}
          {@const canDrag    =
              cell &&
              cell.controller === turn &&
              entityType == "creature" &&
              (entity as Creature).energy_remaining > 0
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
                class:exhausted={entityType == "creature" && (entity as Creature).energy_remaining <= 0}
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
                    <span class="pip" class:pip-spent={e >= c.energy_remaining}></span>
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
          {#each hands[turn].cards[k] as card, i (card.name + i)}
            {@const meta       = uiMeta(card.name)}
            {@const affordable = players[turn].mana >= card.cost}
            <div
              class="hand-card"
              class:unaffordable={!affordable}
              class:casting-card={k === 'casting'}
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
          {/each}
        </div>
      </div>
    {/each}
  </footer>

</div>

<!-- ─── Styles ────────────────────────────────────────────────────────────── -->
<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    height: 100%; overflow: hidden;
    background: #080710; color: #e0d4c4;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 20px;
  }

  /* ── Shell ── */
  .app { height: 100vh; width: 100vw; display: flex; flex-direction: column; overflow: hidden; }

  /* ── Header ── */
  .hdr {
    height: 64px; flex-shrink: 0;
    display: flex; align-items: center; gap: 1.2rem; padding: 0 1.4rem;
    background: #0c0a18; border-bottom: 1px solid #1c1828;
    box-shadow: 0 2px 20px rgba(0,0,0,0.6); z-index: 10;
  }
  .hdr-brand {
    display: flex; align-items: center; gap: 0.55rem;
    font-family: 'Cinzel', serif; font-size: 1.1rem; font-weight: 700;
    color: #e8c040; letter-spacing: 0.06em; flex-shrink: 0;
  }
  .hdr-turn {
    flex: 1; display: flex; align-items: center; gap: 0.9rem;
    font-family: 'Cinzel', serif; font-size: 0.92rem; letter-spacing: 0.04em;
  }
  .active-pip { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .stat-chip {
    display: flex; align-items: center; gap: 0.3rem; font-size: 0.88rem;
    padding: 0.2rem 0.7rem; border-radius: 4px; background: #0e0c1a; border: 1px solid #1c1828;
  }
  .stat-chip i { font-size: 0.82rem; }
  .mana-chip { color: #80b4e0; }
  .hold-chip { color: #a08040; }
  .btn-end-turn {
    margin-left: auto; background: none; border: 1px solid #352e50; border-radius: 5px;
    color: #c0b0e0; font-family: 'Cinzel', serif; font-size: 0.82rem;
    letter-spacing: 0.1em; padding: 0.35rem 1rem; cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .btn-end-turn:hover { background: #1c1830; border-color: #6050a0; color: #e0d4ff; }
  .winner-badge { font-family: 'Cinzel', serif; font-size: 1.05rem; font-weight: 700; letter-spacing: 0.08em; }
  .btn-restart {
    margin-left: 1rem; background: #1a1230; border: 1px solid #4040a0; border-radius: 5px;
    color: #c0b0ff; font-family: 'Cinzel', serif; font-size: 0.82rem; padding: 0.35rem 1rem; cursor: pointer;
  }

  /* ── Body: three-column layout ── */
  .body { flex: 1; display: flex; overflow: hidden; min-height: 0; }

  /* ── Left Sidebar: Inspector ── */
  .sidebar-left {
    width: 22vw; min-width: 200px; flex-shrink: 0;
    background: #0a0816; border-right: 1px solid #1c1828;
    overflow-y: auto; display: flex; flex-direction: column;
    scrollbar-width: thin; scrollbar-color: #201c30 transparent;
  }

  /* ── Right Sidebar: Log ── */
  .sidebar-right {
    width: 18vw; min-width: 190px; flex-shrink: 0;
    background: #0a0816; border-left: 1px solid #1c1828;
    overflow-y: auto; display: flex; flex-direction: column;
    padding: 0.8rem 0.9rem 1.2rem;
    scrollbar-width: thin; scrollbar-color: #201c30 transparent;
  }

  /* ── Inspector shared ── */
  .insp {
    position: relative; padding: 1.4rem 1.1rem 1.6rem;
    display: flex; flex-direction: column; align-items: center; gap: 0.55rem; overflow: hidden;
  }
  .insp-glow {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--ec) 16%, transparent) 0%, transparent 65%);
    pointer-events: none;
  }
  .insp-ring {
    width: 96px; height: 96px; border-radius: 50%; border: 2px solid;
    display: flex; align-items: center; justify-content: center;
    font-size: 3rem; position: relative; z-index: 1;
  }
  .insp-name { font-family: 'Cinzel', serif; font-size: 1.05rem; font-weight: 600; text-align: center; color: #f0e8d4; }
  .insp-cost { font-size: 0.9rem; color: #80b4e0; display: flex; align-items: center; gap: 0.3rem; }
  .rarity-pill { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.12em; }
  .controller-badge { font-family: 'Cinzel', serif; font-size: 0.84rem; font-weight: 600; }
  .insp-flavor {
    font-size: 0.88rem; font-style: italic; color: #857060; text-align: center; line-height: 1.6;
    border-left: 2px solid #221c32; padding-left: 0.6rem; width: 100%;
  }
  .kind-badge {
    font-size: 0.74rem; font-family: 'Cinzel', serif; letter-spacing: 0.08em;
    padding: 0.15rem 0.6rem; border-radius: 4px; border: 1px solid;
  }
  .casting-badge      { color: #c0a020; border-color: #c0a02044; background: #c0a02011; }
  .construction-badge { color: #708060; border-color: #70806044; background: #70806011; }
  .creature-badge     { color: #c05555; border-color: #c0555544; background: #c0555511; }
  .casting-hint { font-size: 0.84rem; font-style: italic; color: #807060; text-align: center; line-height: 1.6; }
  .divider { width: 100%; display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0 0.15rem; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #1c1828; }
  .divider span { font-family: 'Cinzel', serif; font-size: 0.68rem; letter-spacing: 0.14em; color: #503c6a; white-space: nowrap; }
  .stat-list { width: 100%; list-style: none; display: flex; flex-direction: column; gap: 0.28rem; }
  .stat-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.32rem 0.65rem; background: #0e0c1a; border: 1px solid #1c1828; border-radius: 5px;
  }
  .stat-k { font-family: 'Cinzel', serif; font-size: 0.7rem; letter-spacing: 0.08em; color: #806070; text-transform: uppercase; }
  .stat-v { font-size: 0.96rem; color: #e0d4c4; font-weight: 600; }
  .hp-val { color: color-mix(in srgb, #e04040 calc((1 - var(--hpc)) * 100%), #40c060 calc(var(--hpc) * 100%)); }
  .ability-row { gap: 0.5rem; justify-content: flex-start; }
  .ability-row i { color: #e0c040; font-size: 0.84rem; }
  .ab-name { font-size: 0.88rem; color: #c0b080; }
  .exhausted-note { font-size: 0.78rem; color: #804040; font-style: italic; margin-top: 0.35rem; }
  .insp-empty {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.9rem; padding: 2rem 1.2rem; text-align: center;
  }
  .insp-empty i { font-size: 2.6rem; color: #201c30; }
  .insp-empty p { font-size: 0.9rem; font-style: italic; line-height: 1.7; color: #30283e; }

  /* ── Log (right sidebar) ── */
  .log-divider { margin-bottom: 0.5rem; }
  .log-list { list-style: none; display: flex; flex-direction: column; gap: 0.2rem; }
  .log-list li {
    font-size: 0.84rem; color: #504060; line-height: 1.6;
    border-bottom: 1px solid #0e0c1a; padding: 0.14rem 0;
  }
  .log-list li:first-child { color: #b0a0c0; }

  /* ── Arena ── */
  .arena {
    flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden;
    background: radial-gradient(ellipse at 50% 44%, #100d1e 0%, #080710 62%);
    position: relative;
  }
  .arena::after {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 50%, transparent 38%, #080710 100%);
    pointer-events: none;
  }

  .game-grid {
    position: relative; z-index: 1;
    display: grid;
    grid-template-columns: repeat(5, min(calc((60vw - 48px) / 5), calc((100vh - 272px) / 5)));
    grid-template-rows:    repeat(5, min(calc((60vw - 48px) / 5), calc((100vh - 272px) / 5)));
    gap: 6px; background: #0c0a18; padding: 12px; border-radius: 12px;
    border: 1px solid #1c1828;
    box-shadow: 0 0 0 1px #060510, 0 28px 80px rgba(0,0,0,0.9);
  }

  /* ── Cell ── */
  .cell {
    position: relative; background: linear-gradient(140deg, #131020 0%, #0e0c1a 100%);
    border: 1px solid #1a1626; border-radius: 8px; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    transition: border-color 0.15s, background 0.15s, transform 0.12s;
    user-select: none; overflow: hidden;
  }
  .cell:hover { background: linear-gradient(140deg, #1c182e 0%, #141020 100%); border-color: #352e50; transform: scale(1.05); z-index: 5; }
  .cell.drag-over { border-color: #e8c040 !important; background: linear-gradient(140deg, #1e1604 0%, #140e00 100%) !important; transform: scale(1.07) !important; z-index: 6; box-shadow: 0 0 0 2px rgba(232,192,64,0.4); }
  .cell.cell-lifting { opacity: 0.22; transform: scale(0.94) !important; border-style: dashed !important; }
  .cell.castle-cell { background: linear-gradient(140deg, #14100a 0%, #0e0a06 100%) !important; border-color: #604820; }
  .cell.castle-cell::before { content: ''; position: absolute; inset: 0; border-radius: 8px; box-shadow: inset 0 0 22px rgba(200,140,20,0.1); pointer-events: none; }
  .cell.cell-a { border-color: #1a3060; }
  .cell.cell-b { border-color: #601a1a; }
  /* Pulse when a casting card is being dragged and this cell is a valid target */
  .cell.casting-target {
    border-color: #c0a02088;
    box-shadow: 0 0 8px rgba(192,160,32,0.3);
  }

  .coord { position: absolute; top: 4px; left: 6px; font-size: 0.56rem; color: #24204a; font-family: 'Cinzel', serif; pointer-events: none; }
  .castle-icon { font-size: 2.6rem; color: #806040; opacity: 0.4; pointer-events: none; }

  .ent-icon { font-size: 2.9rem; line-height: 1; pointer-events: none; transition: transform 0.2s; }
  .cell:hover .ent-icon { transform: scale(1.1); }
  .ent-icon.exhausted { opacity: 0.38; filter: grayscale(70%) !important; }

  .hp-bar-wrap { position: absolute; bottom: 14px; left: 8px; right: 8px; height: 4px; background: #1a1628; border-radius: 2px; }
  .hp-bar { height: 100%; border-radius: 2px; transition: width 0.3s; }

  .atk-badge { position: absolute; top: 4px; right: 6px; font-size: 0.72rem; font-family: 'Cinzel', serif; font-weight: 700; color: #e0a040; line-height: 1; }
  .construction-marker { position: absolute; top: 4px; right: 6px; font-size: 0.7rem; opacity: 0.6; }

  .energy-pips { position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); display: flex; gap: 4px; }
  .pip { width: 7px; height: 7px; border-radius: 50%; background: #80d090; box-shadow: 0 0 5px #40a06088; transition: background 0.2s, box-shadow 0.2s; }
  .pip.pip-spent { background: #2a2030; box-shadow: none; }

  .drop-hint { width: 28px; height: 28px; border-radius: 50%; border: 1px dashed #2a2448; animation: pulse-ring 1.5s ease-in-out infinite; }
  @keyframes pulse-ring { 0%, 100% { opacity: 0.2; transform: scale(0.88); } 50% { opacity: 0.55; transform: scale(1.1); } }

  /* ── Hand area ── */
  .hand-area {
    height: 160px; flex-shrink: 0;
    background: #0a0816; border-top: 1px solid #1c1828;
    box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
    display: flex; align-items: stretch; gap: 0; padding: 0; z-index: 5; overflow: hidden;
  }
  .hand-section {
    display: flex; align-items: center; flex: 1; border-right: 1px solid #141020;
    padding: 0 0.5rem;
  }
  .hand-section:last-child { border-right: none; }
  .hand-section-label {
    font-size: 1.2rem; padding: 0 0.4rem; flex-shrink: 0; opacity: 0.5;
  }
  .hand-scroll {
    display: flex; gap: 0.65rem; overflow-x: auto; flex: 1;
    padding: 0.5rem 0; scrollbar-width: thin; scrollbar-color: #201c2e transparent; align-items: center;
  }
  .hand-card {
    position: relative; width: 108px; height: 140px; flex-shrink: 0;
    background: linear-gradient(160deg, #13101e 0%, #0e0c1a 100%);
    border: 1px solid #1e1830; border-radius: 8px;
    cursor: grab; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 5px; transition: border-color 0.14s, transform 0.12s; overflow: hidden; outline: none;
  }
  .hand-card:hover { border-color: #3c3460; transform: translateY(-10px) scale(1.05); z-index: 5; box-shadow: 0 16px 36px rgba(0,0,0,0.7); }
  .hand-card.unaffordable { opacity: 0.38; cursor: not-allowed; }
  .hand-card:active { cursor: grabbing; }
  .hand-card i { font-size: 2.6rem; pointer-events: none; transition: transform 0.2s; }
  .hand-card:hover i { transform: scale(1.1); }
  /* Casting cards get a golden shimmer */
  .hand-card.casting-card { background: linear-gradient(160deg, #161108 0%, #0e0c06 100%); border-color: #2a2210; }
  .hand-card.casting-card:hover { border-color: #c0a02088; box-shadow: 0 16px 36px rgba(192,160,32,0.2); }
  .card-cost { position: absolute; top: 5px; left: 7px; font-size: 0.78rem; font-family: 'Cinzel', serif; color: #80b4e0; display: flex; align-items: center; gap: 2px; }
  .card-cost i { font-size: 0.72rem; }
  .card-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: #c0b080; text-align: center; pointer-events: none; line-height: 1.35; padding: 0 4px; }
  .card-stats { display: flex; gap: 7px; font-size: 0.72rem; color: #605070; pointer-events: none; }
  .casting-tag { color: #907020; font-style: italic; font-size: 0.7rem; }
  .rarity-bar { position: absolute; top: 0; left: 0; right: 0; height: 3px; border-radius: 8px 8px 0 0; opacity: 0.85; }
</style>
