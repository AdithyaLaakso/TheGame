<svelte:head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rpg-awesome@0.2.0/css/rpg-awesome.min.css" />
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,400&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
  // ─── Types ────────────────────────────────────────────────────────────────────
  type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

  interface VariableStat {
    base: number;
    current: number;
  }

  interface Entity {
    type:   string;
    icon:   string;   // RPG Awesome icon class e.g. "ra-sword"
    label:  string;
    flavor: string;
    stats:  Record<string, number | VariableStat | string>;
    color:  string;
    rarity: Rarity;
  }

  interface Cell {
    id:     number;
    entity: Entity | null;
  }

  // ─── Entity catalogue ─────────────────────────────────────────────────────────
  const CATALOGUE: Record<string, Entity> = {
    hero: {
      type: 'hero', icon: 'ra-player', label: 'Hero',
      flavor: 'A seasoned adventurer who has delved into countless dungeons. Every scar tells a story.',
      stats: { HP: 100, ATK: 15, DEF: 10, SPD: 8 },
      color: '#6ab0ff', rarity: 'legendary',
    },
    dragon: {
      type: 'dragon', icon: 'ra-dragon', label: 'Dragon',
      flavor: 'An ancient wyrm of terrible power. Its breath melts stone and its scales deflect steel.',
      stats: { HP: 400, ATK: 60, DEF: 40, SPD: 5 },
      color: '#ff5040', rarity: 'legendary',
    },
    orc: {
      type: 'orc', icon: 'ra-axe', label: 'Orc Raider',
      flavor: 'A brutish mercenary more interested in plunder than tactics. Do not underestimate raw muscle.',
      stats: { HP: 80, ATK: 18, DEF: 6, SPD: 4 },
      color: '#70cc50', rarity: 'uncommon',
    },
    wolf: {
      type: 'wolf', icon: 'ra-wolf', label: 'Dungeon Wolf',
      flavor: 'A feral wolf that prowls the lower corridors. Hunts in packs whenever possible.',
      stats: { HP: 45, ATK: 22, DEF: 3, SPD: 14 },
      color: '#b090e8', rarity: 'common',
    },
    skeleton: {
      type: 'skeleton', icon: 'ra-skull', label: 'Skeleton',
      flavor: 'Reanimated bones bound by dark magic. It knows only the hunger of its long-dead master.',
      stats: { HP: 40, ATK: 10, DEF: 12, SPD: 5 },
      color: '#d8cc98', rarity: 'common',
    },
    goblin: {
      type: 'goblin', icon: 'ra-imp', label: 'Goblin Scout',
      flavor: 'Small, cowardly, and cunning. Goblins prefer ambushes to fair fights — always.',
      stats: { HP: 25, ATK: 8, DEF: 2, SPD: 16 },
      color: '#90d040', rarity: 'common',
    },
    tree: {
      type: 'tree', icon: 'ra-oak-tree', label: 'Ancient Oak',
      flavor: 'A twisted tree grown from a crack in the dungeon floor. It has been here longer than memory.',
      stats: { Type: 'Obstacle', Durability: '∞' },
      color: '#4a9040', rarity: 'common',
    },
    crystal: {
      type: 'crystal', icon: 'ra-gem', label: 'Magic Crystal',
      flavor: 'A cluster of crystals humming with latent power. Worth a fortune to the right arcane dealer.',
      stats: { Type: 'Terrain', Value: '500 GP', Magic: 'Latent' },
      color: '#60d0e0', rarity: 'uncommon',
    },
    chest: {
      type: 'chest', icon: 'ra-locked-chest', label: 'Treasure Chest',
      flavor: 'Iron-banded and sealed with a complex lock. Whatever is inside has been kept safe for centuries.',
      stats: { Contents: 'Unknown', Lock: 'Complex', Type: 'Object' },
      color: '#d4a820', rarity: 'rare',
    },
    tower: {
      type: 'tower', icon: 'ra-tower', label: 'Watch Tower',
      flavor: 'A crumbling tower rising to the cavern ceiling. Once a sentinel post — now a ruin.',
      stats: { Height: '40 ft', Condition: 'Ruined', Type: 'Structure' },
      color: '#8898b0', rarity: 'uncommon',
    },
    potion: {
      type: 'potion', icon: 'ra-potion', label: 'Healing Potion',
      flavor: 'A ruby-red liquid that smells faintly of roses. Restores vitality when consumed.',
      stats: { Restore: '+50 HP', Uses: 1, Type: 'Consumable' },
      color: '#e060b0', rarity: 'uncommon',
    },
  };

  const RARITY_COLORS: Record<Rarity, string> = {
    common:    '#7a6a5a',
    uncommon:  '#3aaa40',
    rare:      '#4878e0',
    legendary: '#d4a020',
  };

  // ─── Initial 5×5 grid layout ─────────────────────────────────────────────────
  const INITIAL: (string | null)[] = [
    'tree',    null,      null,      'crystal', 'tower',
    null,      'wolf',    null,      null,      null,
    null,      null,      'hero',    null,      'chest',
    'crystal', null,      null,      'skeleton', null,
    'orc',     null,      'potion',  null,      'tree',
  ];

  // ─── Reactive state ───────────────────────────────────────────────────────────
  let grid: Cell[] = INITIAL.map((k, i) => ({
    id: i,
    entity: k ? { ...CATALOGUE[k] } : null,
  }));

  // Bench — finite pool consumed on placement
  let bench: Entity[] = [
    CATALOGUE.dragon,
    CATALOGUE.goblin,
    CATALOGUE.orc,
    CATALOGUE.wolf,
    CATALOGUE.skeleton,
    CATALOGUE.potion,
    CATALOGUE.chest,
    CATALOGUE.crystal,
  ].map(e => ({ ...e }));

  // Drag tracking
  let dragSrc:   { kind: 'grid' | 'bench'; idx: number } | null = null;
  let dragOverIdx: number | null = null;
  let isDragging = false;

  // Sidebar inspector
  let inspected: { entity: Entity | null; location: string } | null = null;

  // ─── Drag handlers ────────────────────────────────────────────────────────────
  function gridDragStart(e: DragEvent, i: number) {
    if (!grid[i].entity) { e.preventDefault(); return; }
    dragSrc = { kind: 'grid', idx: i };
    isDragging = true;
    e.dataTransfer!.effectAllowed = 'move';
  }

  function benchDragStart(e: DragEvent, i: number) {
    dragSrc = { kind: 'bench', idx: i };
    isDragging = true;
    e.dataTransfer!.effectAllowed = 'copy';
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    dragOverIdx = i;
    e.dataTransfer!.dropEffect = dragSrc?.kind === 'bench' ? 'copy' : 'move';
  }

  function onDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    if (!dragSrc) { resetDrag(); return; }

    if (dragSrc.kind === 'grid') {
      const fi = dragSrc.idx;
      if (fi !== toIdx) {
        const [fe, te] = [grid[fi].entity, grid[toIdx].entity];
        grid = grid.map((c, i) => {
          if (i === fi)    return { ...c, entity: te };
          if (i === toIdx) return { ...c, entity: fe };
          return c;
        });
      }
    } else {
      const entity = { ...bench[dragSrc.idx] };
      grid = grid.map((c, i) => i === toIdx ? { ...c, entity } : c);
      bench = bench.filter((_, i) => i !== dragSrc!.idx);
    }

    resetDrag();
  }

  function resetDrag() {
    dragSrc = null;
    dragOverIdx = null;
    isDragging = false;
  }

  // ─── Inspector ────────────────────────────────────────────────────────────────
  function inspectCell(cell: Cell, i: number) {
    const row = Math.floor(i / 5) + 1;
    const col = (i % 5) + 1;
    inspected = {
      entity: cell.entity,
      location: `Grid · Row ${row}, Col ${col}`,
    };
  }

  function inspectBench(e: Entity) {
    inspected = { entity: e, location: 'Reserves Bench' };
  }

  // ─── Cell class builder ───────────────────────────────────────────────────────
  function cellClass(i: number): string {
    const parts = ['cell'];
    if (isDragging && dragOverIdx === i)                        parts.push('drag-over');
    if (dragSrc?.kind === 'grid' && dragSrc.idx === i)         parts.push('cell-lifting');
    if (grid[i].entity?.type === 'hero')                       parts.push('hero-cell');
    return parts.join(' ');
  }
</script>

<!-- ─── Markup ─────────────────────────────────────────────────────────────────── -->
<div class="app">

  <!-- HEADER ------------------------------------------------------------------ -->
  <header class="hdr">
    <div class="hdr-brand">
      <i class="ra ra-castle-emblem" aria-hidden="true"></i>
      <span>Dungeon Grid</span>
    </div>
  </header>

  <!-- BODY -------------------------------------------------------------------- -->
  <div class="body">

    <!-- SIDEBAR -->
    <aside class="sidebar">
      {#if inspected?.entity}
        {@const ent = inspected.entity}
        <div class="insp">
          <!-- ambient colour glow behind the icon -->
          <div class="insp-glow" style="--ec:{ent.color}"></div>

          <div class="insp-ring" style="border-color:{ent.color}55; background:{ent.color}0d;">
            <i class="ra {ent.icon}" style="color:{ent.color}" aria-hidden="true"></i>
          </div>

          <h2 class="insp-name">{ent.label}</h2>

          <blockquote class="insp-flavor">"{ent.flavor}"</blockquote>

          <div class="divider"><span>ATTRIBUTES</span></div>

          <ul class="stat-list">
            {#each Object.entries(ent.stats) as [k, v]}
              <li class="stat-row">
                <span class="stat-k">{k}</span>
                <span class="stat-v">{v}</span>
              </li>
            {/each}
          </ul>
        </div>

      {:else}
        <div class="insp-empty">
          <i class="ra ra-scroll" aria-hidden="true"></i>
          <p>Click any entity on the grid or bench to inspect it here</p>
        </div>
      {/if}
    </aside>

    <!-- ARENA -->
    <main class="arena">
      <div
        class="game-grid"
        aria-label="Game board"
        on:dragend={resetDrag}
      >
        {#each grid as cell, i}
          <div
            class={cellClass(i)}
            role="gridcell"
            aria-label={cell.entity?.label ?? 'Empty cell'}
            draggable={!!cell.entity}
            on:dragstart={e => gridDragStart(e, i)}
            on:dragover={e => onDragOver(e, i)}
            on:drop={e => onDrop(e, i)}
            on:click={() => inspectCell(cell, i)}
          >
            <span class="coord" aria-hidden="true">{Math.floor(i/5)},{i%5}</span>

            {#if cell.entity}
              <i
                class="ra {cell.entity.icon} ent-icon"
                style="color:{cell.entity.icon === 'ra-player'
                  ? cell.entity.color
                  : cell.entity.color};
                  filter:drop-shadow(0 0 8px {cell.entity.color}66)"
                aria-hidden="true"
              ></i>
            {:else if isDragging}
              <span class="drop-hint" aria-hidden="true"></span>
            {/if}
          </div>
        {/each}
      </div>
    </main>

  </div><!-- /body -->

  <!-- BENCH ------------------------------------------------------------------- -->
  <footer class="bench">
    <div class="bench-title">
      <i class="ra ra-hand" aria-hidden="true"></i>
      <span>Reserves</span>
    </div>

    <div class="bench-scroll">
      {#each bench as entity, i (entity.type + i)}
        <div
          class="bench-card"
          draggable="true"
          role="button"
          tabindex="0"
          aria-label="Drag {entity.label} onto the grid"
          on:dragstart={e => benchDragStart(e, i)}
          on:dragend={resetDrag}
          on:click={() => inspectBench(entity)}
          on:keydown={e => e.key === 'Enter' && inspectBench(entity)}
        >
          <span class="rarity-bar" style="background:{RARITY_COLORS[entity.rarity]}"></span>
          <i class="ra {entity.icon}" style="color:{entity.color}" aria-hidden="true"></i>
          <span class="bench-label">{entity.label}</span>
        </div>
      {:else}
        <p class="bench-empty">All reserves have been deployed.</p>
      {/each}
    </div>
  </footer>

</div>

<!-- ─── Styles ─────────────────────────────────────────────────────────────────── -->
<style>
  /* ── Global reset ── */
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(html, body) {
    height: 100%;
    overflow: hidden;
    background: #080710;
    color: #e0d4c4;
    font-family: 'Crimson Pro', Georgia, serif;
  }

  /* ── App shell ── */
  .app {
    height: 100vh;
    width: 100vw;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
  .hdr {
    height: 50px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 0 1.25rem;
    background: #0c0a18;
    border-bottom: 1px solid #1c1828;
    box-shadow: 0 2px 20px rgba(0,0,0,0.6);
    z-index: 10;
  }

  .hdr-brand {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-family: 'Cinzel', serif;
    font-size: 1.05rem;
    font-weight: 700;
    color: #e8c040;
    letter-spacing: 0.06em;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .hdr-brand i { font-size: 1.15rem; }

  .hdr-hint {
    flex: 1;
    font-size: 0.78rem;
    color: #40384e;
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hdr-badge {
    flex-shrink: 0;
    font-family: 'Cinzel', serif;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    border: 1px solid #2a2440;
    border-radius: 99px;
    padding: 0.15rem 0.6rem;
    color: #4a4060;
  }

  /* ── Body row ── */
  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 20vw;
    flex-shrink: 0;
    background: #0a0816;
    border-right: 1px solid #1c1828;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: #201c30 transparent;
  }

  /* Inspector panel */
  .insp {
    position: relative;
    padding: 1.5rem 1.1rem 2rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    overflow: hidden;
  }

  .insp-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% -10%,
      color-mix(in srgb, var(--ec) 14%, transparent) 0%,
      transparent 65%);
    pointer-events: none;
  }

  .insp-ring {
    width: 82px;
    height: 82px;
    border-radius: 50%;
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.6rem;
    margin-bottom: 0.2rem;
    position: relative;
    z-index: 1;
    transition: border-color 0.3s, background 0.3s;
  }

  .pip {
    width: 6px; height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .insp-name {
    font-family: 'Cinzel', serif;
    font-size: 5rem;
    font-weight: 600;
    text-align: center;
    color: #f0e8d4;
  }

  .insp-flavor {
    font-size: 1.5rem;
    font-style: italic;
    color: '#857060';
    color: #857060;
    text-align: center;
    line-height: 1.62;
    border-left: 2px solid #221c32;
    padding-left: 0.75rem;
    margin: 0.4rem 0;
    width: 100%;
  }

  .divider {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.2rem 0 0.1rem;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #1c1828;
  }
  .divider span {
    font-family: 'Cinzel', serif;
    font-size: 1.5rem;
    letter-spacing: 0.14em;
    color: white;
  }

  .stat-list {
    width: 100%;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.28rem 0.6rem;
    background: #0e0c1a;
    border: 1px solid #1c1828;
    border-radius: 4px;
  }

  .stat-k {
    font-family: 'Cinzel', serif;
    font-size: 1.58rem;
    letter-spacing: 0.08em;
    color: white;
    text-transform: uppercase;
  }

  .stat-v {
    font-size: 1.2rem;
    color: #e0d4c4;
    font-weight: 600;
  }

  /* Empty state */
  .insp-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    color: '#252030';
    color: #252030;
    padding: 3rem 1.25rem;
    text-align: center;
  }
  .insp-empty i  { font-size: 2.6rem; color: #201c30; }
  .insp-empty p  { font-size: 0.86rem; font-style: italic; line-height: 1.65; color: #30283e; }

  /* ── Arena ── */
  .arena {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: radial-gradient(ellipse at 50% 44%, #100d1e 0%, #080710 62%);
    position: relative;
  }

  /* Vignette */
  .arena::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at 50% 50%, transparent 38%, #080710 100%);
    pointer-events: none;
  }

  /* ── Grid ── */
  .game-grid {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(5, 15vw);
    grid-template-rows:    repeat(5, 15vh);
    gap: 5px;
    background: #0c0a18;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid #1c1828;
    box-shadow:
      0 0 0 1px #060510,
      0 28px 80px rgba(0,0,0,0.9),
      inset 0 1px 0 rgba(255,210,80,0.03);
  }

  /* ── Cell ── */
  .cell {
    position: relative;
    background: linear-gradient(140deg, #131020 0%, #0e0c1a 100%);
    border: 1px solid #1a1626;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    transition: border-color 0.15s, background 0.15s, transform 0.12s, box-shadow 0.15s;
    user-select: none;
    overflow: hidden;
  }

  .cell:hover {
    background: linear-gradient(140deg, #1c182e 0%, #141020 100%);
    border-color: #352e50;
    transform: scale(1.06);
    z-index: 5;
    box-shadow: 0 10px 28px rgba(0,0,0,0.7);
  }

  .cell.drag-over {
    border-color: #e8c040 !important;
    background: linear-gradient(140deg, #1e1604 0%, #140e00 100%) !important;
    box-shadow: 0 0 0 2px rgba(232,192,64,0.4), inset 0 0 30px rgba(232,192,64,0.06);
    transform: scale(1.07) !important;
    z-index: 6;
  }

  .cell.cell-lifting {
    opacity: 0.22;
    transform: scale(0.94) !important;
    border-style: dashed !important;
  }

  .cell.hero-cell {
    background: linear-gradient(140deg, #091826 0%, #060e18 100%);
    border-color: #1a3d5a;
  }

  .coord {
    position: absolute;
    top: 3px;
    left: 5px;
    font-size: 0.46rem;
    color: #24204a;
    font-family: 'Cinzel', serif;
    line-height: 1;
    pointer-events: none;
  }

  .ent-icon {
    font-size: 2.3rem;
    line-height: 1;
    pointer-events: none;
    transition: transform 0.2s;
  }
  .cell:hover .ent-icon { transform: scale(1.12); }

  .ent-label {
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #30284a;
    pointer-events: none;
    line-height: 1;
  }

  /* Drop-target pulse ring (shown on empty cells while dragging) */
  .drop-hint {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px dashed #2a2448;
    animation: pulse-ring 1.5s ease-in-out infinite;
  }

  @keyframes pulse-ring {
    0%, 100% { opacity: 0.25; transform: scale(0.88); }
    50%       { opacity: 0.65; transform: scale(1.12); }
  }

  /* ── Bench ── */
  .bench {
    height: 114px;
    flex-shrink: 0;
    background: #0a0816;
    border-top: 1px solid #1c1828;
    box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 1.25rem;
    z-index: 5;
  }

  .bench-title {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
    font-family: 'Cinzel', serif;
    font-size: 0.56rem;
    letter-spacing: 0.12em;
    color: '#342c48';
    color: #342c48;
    text-transform: uppercase;
  }
  .bench-title i { font-size: 1.2rem; color: #403858; }

  .bench-scroll {
    display: flex;
    gap: 0.55rem;
    overflow-x: auto;
    flex: 1;
    padding: 0.5rem 0;
    scrollbar-width: thin;
    scrollbar-color: #201c2e transparent;
    align-items: center;
  }

  .bench-card {
    position: relative;
    width: 72px;
    height: 82px;
    flex-shrink: 0;
    background: linear-gradient(155deg, #13101e 0%, #0e0c1a 100%);
    border: 1px solid #1e1830;
    border-radius: 7px;
    cursor: grab;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: border-color 0.14s, transform 0.12s, box-shadow 0.14s;
    overflow: hidden;
    outline: none;
  }

  .bench-card:hover {
    border-color: #3c3460;
    transform: translateY(-5px) scale(1.05);
    box-shadow: 0 12px 32px rgba(0,0,0,0.65);
    z-index: 5;
  }

  .bench-card:focus-visible {
    border-color: #e8c040;
    box-shadow: 0 0 0 2px rgba(232,192,64,0.35);
  }

  .bench-card:active { cursor: grabbing; }

  .bench-card i {
    font-size: 1.95rem;
    pointer-events: none;
    transition: transform 0.2s;
  }
  .bench-card:hover i { transform: scale(1.1); }

  .bench-label {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: white;
    text-align: center;
    pointer-events: none;
    line-height: 1.3;
    padding: 0 4px;
  }

  /* thin rarity stripe at top of card */
  .rarity-bar {
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    border-radius: 7px 7px 0 0;
    opacity: 0.85;
  }

  .bench-empty {
    font-style: italic;
    color: #2e2840;
    font-size: 0.86rem;
  }
</style>
