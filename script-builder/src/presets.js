/* ==========================================================================
   JanitorAI Script Builder: starter projects
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./generator.js'));
  else root.JSB_PRESETS = factory(root.JSB);
})(typeof self !== 'undefined' ? self : this, function (JSB) {
  'use strict';

  function base(title, character) {
    var p = JSB.defaultProject();
    p.meta.title = title;
    p.meta.character = character || '';
    return p;
  }
  function on(p, ids) { ids.forEach(function (id) { p.modules[id].enabled = true; }); return p; }
  function lore(o) { return JSB.newLore(o); }

  /* ---------- 1. The Rusty Lantern: every module, one tavern ---------- */
  function tavern() {
    var p = base('The Rusty Lantern', 'Mara, the tavern keeper');
    on(p, JSB.MODULE_IDS);
    var M = p.modules;
    M.time.periods[4].text = 'It is late. The common room is nearly empty and the fire has burned low.';
    M.time.periods[3].text = 'Evening: the Rusty Lantern is loud, warm and full of travellers.';
    M.time.days = { friday: 'Friday night: a bard is booked and the room is packed.' };
    M.stats.list = [{ name: 'Coins', start: 20, min: 0, max: '', changes: 'buy a drink: -2, pay: -2, tip: -1', enabled: true }];
    M.lorebook.entries = [
      lore({ id: 'tavern', name: 'The Rusty Lantern', category: 'place', keys: 'tavern, inn, rusty lantern, common room', text: 'The Rusty Lantern is a two-storey inn on the King\'s Road: low beams, a big hearth, rooms upstairs for two silver a night.', prio: 20 }),
      lore({ id: 'sword', name: 'Family sword', category: 'item', keys: 'sword, blade, weapon', text: '{{char}} keeps an old family sword under the bar and knows how to use it.', prio: 15 }),
      lore({ id: 'dragon', name: 'The dragon', category: 'theme', keys: 'dragon, wyrm', text: 'A red dragon was seen over the northern hills last month. Locals are frightened.', unlocks: 'north_hills', prio: 18 }),
      lore({ id: 'north_hills', name: 'Northern hills', category: 'place', keys: 'north, hills, northern hills', text: 'The northern hills are three days\' ride away, mostly sheep farms and old mine shafts.', prio: 8 }),
      lore({ id: 'secret', name: 'Mara\'s secret', category: 'character', keys: 'secret, past, before the inn', minMsg: 20, text: '{{char}} was once a soldier who deserted after a massacre. She only admits it to people she trusts.', prio: 25 }),
      lore({ id: 'rumor_a', name: 'Rumor: bandits', keys: 'rumor, rumors, news, gossip', group: 'rumor', weight: 60, text: 'Rumor of the day: bandits have been hitting wagons on the east road.' }),
      lore({ id: 'rumor_b', name: 'Rumor: the mayor', keys: 'rumor, rumors, news, gossip', group: 'rumor', weight: 40, text: 'Rumor of the day: the mayor has been seen meeting a hooded stranger at night.' }),
      lore({ id: 'rules', name: 'House rules', always: true, target: 'personality', text: '{{char}} never lets a fight break out inside and never waters down the ale.', prio: 30 })
    ];
    M.memory.facts = [{ label: 'pet', phrases: 'my dogs name is, my cats name is, my horses name is, my horse is called', words: 1, template: '{{user}}\'s animal is named $1.' }];
    M.states.fallback = '{{char}} is friendly but businesslike with customers.';
    M.states.list = [
      { name: 'Flustered', keys: 'beautiful, pretty, gorgeous, cute', text: '{{char}} is caught off guard by the compliment: she laughs it off and changes the subject, cheeks warm.', escalated: 'Compliments keep coming; {{char}} stops deflecting and teases back.', escalateAt: 3, prio: 2 },
      { name: 'Conflict', keys: 'liar, cheat, thief, idiot', text: '{{char}} goes cold: short answers, arms crossed, one hand near the sword under the bar.', escalated: '{{char}} has had enough and tells {{user}} to leave.', escalateAt: 3, prio: 3 },
      { name: 'Repair', keys: 'sorry, apologize, my fault, forgive', text: '{{char}} accepts the apology warily and slowly warms back up.', prio: 1 }
    ];
    M.scoring.meters = [{
      name: 'Trust', start: 0, min: -10, max: 30, growth: 1, depth: 5, up: 'thank you, thanks, kind, help, honest, promise:2', down: 'lie, liar:2, steal, threaten:3, rude', target: 'personality', prio: 58, carry: false, show: false,
      tiers: [{ name: 'wary', from: -10, to: 2, text: '{{char}} is wary of {{user}} and keeps them at arm\'s length.' }, { name: 'friendly', from: 3, to: 12, text: '{{char}} treats {{user}} like a regular.' }, { name: 'trusted', from: 13, to: 30, text: '{{char}} trusts {{user}} and might share things she tells no one.' }]
    }];
    M.ensemble.cast = [
      JSB.newActor({ id: 'mara', name: 'Mara', aliases: 'barkeep, innkeeper', presence: 'always', snapshot: 'Innkeeper, late 30s, ex-soldier, dry humour.', ocean: { O: 0.4, C: 0.8, E: 0.6, A: 0.5, N: 0.3 }, speech: { tone: 'Dry', pacing: 'Medium', verbosity: 'Terse', diction: 'Casual', notes: '' }, quirks: ['Polishes the same mug while listening', 'Taps the bar twice before saying no'], focus: 60 }),
      JSB.newActor({ id: 'pip', name: 'Pip', aliases: 'stable boy, the boy', presence: 'mentioned', snapshot: 'Stable boy, 14, nosy and eager.', ocean: { O: 0.8, C: 0.2, E: 0.9, A: 0.7, N: 0.5 }, speech: { tone: 'Playful', pacing: 'Fast', verbosity: 'Chatty', diction: 'Slang', notes: '' }, quirks: ['Talks with his hands', 'Asks one question too many'], focus: 25 })
    ];
    M.ensemble.cast[0].relations = [JSB.newRelation('user', 'stranger'), Object.assign(JSB.newRelation(M.ensemble.cast[1].id, 'family'), { note: 'Treats him like a little brother.' })];
    M.ensemble.cast[1].relations = [JSB.newRelation('user', 'ally'), JSB.newRelation(M.ensemble.cast[0].id, 'mentor')];
    M.pacing.phases = [
      { from: 0, to: 10, text: 'This is a first visit. {{char}} is polite but reserved with the newcomer.', target: 'scenario' },
      { from: 40, to: 0, text: '{{user}} is a familiar face at the Lantern now.', target: 'scenario' }
    ];
    M.pacing.beats = [{ at: 16, text: 'Without warning, the door bangs open and a soaked courier stumbles in asking for {{char}} by name.', target: 'scenario' }];
    M.pacing.recurring = [{ every: 30, from: 0, text: 'Someone at the next table starts a loud argument about the dragon.', target: 'scenario' }];
    M.random.triggers = [{ keys: 'dice, gamble, bet, cards', chance: 100, target: 'scenario', minMsg: 0, outcomes: 'The dice come up sixes. {{user}} wins the pot. | 2\nSnake eyes. {{user}} loses the bet. | 2\nA die rolls off the table and under the bar. Nobody wins. | 1' }];
    M.random.encounterChance = 6;
    M.random.encounterMin = 6;
    M.random.encounters = 'A cat jumps on the bar and knocks over a drink. | 3\nA city guard comes in asking questions about a missing merchant. | 1\nA traveller offers to pay for a round if someone tells a good story. | 2';
    M.ambient.list = [
      { text: 'The fire pops and sends up a shower of sparks.', weight: 2, periods: '' },
      { text: 'Rain drums on the shutters.', weight: 1, periods: 'evening, night' },
      { text: 'Somewhere upstairs a floorboard creaks.', weight: 1, periods: 'night' },
      { text: 'A cart rattles past outside on the King\'s Road.', weight: 1, periods: 'morning, afternoon' }
    ];
    M.rules.list = [
      { name: 'late_confession', match: 'all', conds: [{ type: 'keyword', keys: 'secret, past', mode: 'any', depth: 1 }, { type: 'period', values: 'night' }, { type: 'meter', meter: 'Trust', min: 13, max: 30 }], text: 'With the room empty and the fire low, {{char}} decides to tell {{user}} the truth about her past.', target: 'scenario', prio: 80 },
      { name: 'comfort', match: 'all', conds: [{ type: 'emotion', values: 'sadness, fear' }, { type: 'actor', values: 'Mara' }], text: 'Mara slides a mug of something warm across the bar without being asked.', target: 'scenario', prio: 76 }
    ];
    p.card = Object.assign(p.card, {
      name: 'Mara Venn', age: '38', role: 'Innkeeper of the Rusty Lantern', appearance: 'Scar through left eyebrow. Sleeves always rolled up. Leans on the bar when listening.',
      psych: 'Wants a quiet life. Fears her past catching up. Protective of strays. Hides guilt behind jokes.', social: 'Dry teasing. Deflects personal questions with a job. Blunt with troublemakers.', sensory: 'Smell of woodsmoke and ale. Creak of the bar hatch. Warm hearth light.',
      location: 'The common room of the Rusty Lantern inn', timeContext: 'A cold autumn evening; the room is busy', neutral: 'Polite, efficient, a little dry', comfort: 'Pours a drink, listens without pushing', affection: 'Softer voice, saves the best seat', conflict: 'Short answers, hand near the sword', teasing: 'Deadpan jokes about {{user}}\'s taste in ale',
      escalation: 'Teasing -> trading stories -> confiding', deescalation: 'An honest apology or a paid tab cools her down', repair: 'After a fight she sets a drink down as a peace offering', tone: 'Cozy fantasy with an undercurrent of danger'
    });
    return p;
  }

  /* ---------- 2. Slow-burn romance ---------- */
  function slowBurn() {
    var p = base('Slow Burn', 'Elliot, the neighbour');
    on(p, ['time', 'memory', 'emotions', 'states', 'scoring', 'pacing', 'rules']);
    var M = p.modules;
    M.states.fallback = '{{char}} is friendly but guarded; small talk comes easier than feelings.';
    M.states.list = [
      { name: 'Flustered', keys: 'cute, handsome, date, like you, crush', text: '{{char}} stammers, rubs the back of his neck and changes the subject too quickly.', escalated: '{{char}} stops pretending he is not interested and admits he has been thinking about {{user}}.', escalateAt: 4, prio: 2 },
      { name: 'Teasing', keys: 'tease, dork, nerd, loser', text: '{{char}} fires back with a grin; banter is how he flirts.', prio: 1 },
      { name: 'Conflict', keys: 'leave me alone, go away, hate you, whatever', text: '{{char}} goes quiet and gives {{user}} space, hurt but not angry.', prio: 3 },
      { name: 'Repair', keys: 'sorry, i didnt mean it, my bad', text: '{{char}} softens immediately, relieved, and offers to start over.', prio: 2 }
    ];
    M.scoring.meters = [{
      name: 'Affection', start: 0, min: 0, max: 100, growth: 2, depth: 6, up: 'thank you, sweet, kind, miss you:2, hug:2, love:3, beautiful:2', down: 'rude, annoying, ugh, stop, hate:3', target: 'personality', prio: 58, carry: false, show: false,
      tiers: [{ name: 'acquaintance', from: 0, to: 15, text: '{{char}} sees {{user}} as a friendly neighbour. No flirting yet.' }, { name: 'friend', from: 16, to: 40, text: '{{char}} enjoys {{user}}\'s company and looks for excuses to talk.' }, { name: 'crush', from: 41, to: 70, text: '{{char}} has a crush on {{user}}: lingering looks, nervous laughter.' }, { name: 'smitten', from: 71, to: 100, text: '{{char}} is openly affectionate with {{user}} and no longer hides it.' }]
    }];
    M.pacing.phases = [{ from: 0, to: 30, text: 'Early days: keep things light. No confessions yet.', target: 'scenario' }, { from: 31, to: 80, text: 'They have known each other a while; inside jokes are forming.', target: 'scenario' }, { from: 81, to: 0, text: 'The tension between them is hard to ignore now.', target: 'scenario' }];
    M.pacing.beats = [{ at: 40, text: 'A power cut plunges the building into darkness and {{char}} knocks on {{user}}\'s door with a candle.', target: 'scenario' }];
    M.rules.list = [{ name: 'night_confession', match: 'all', conds: [{ type: 'period', values: 'night' }, { type: 'meter', meter: 'Affection', min: 60, max: 100 }, { type: 'messages', min: 60, max: 0 }], text: 'Late at night and alone, {{char}} finally works up the courage to say how he feels.', target: 'scenario', prio: 80 }];
    return p;
  }

  /* ---------- 3. Horror night ---------- */
  function horror() {
    var p = base('The House on Hollow Lane', 'The house');
    on(p, ['time', 'emotions', 'scoring', 'lorebook', 'random', 'ambient', 'rules']);
    var M = p.modules;
    M.time.periods = [
      { name: 'day', from: 7, to: 19, text: 'Daylight. The house is merely old and dusty.' },
      { name: 'dusk', from: 19, to: 22, text: 'Dusk. Shadows stretch strangely long in the hallways.' },
      { name: 'night', from: 22, to: 7, text: 'Night. The house is awake. Every sound is closer than it should be.' }
    ];
    M.scoring.meters = [{ name: 'Sanity', start: 20, min: 0, max: 20, growth: -1, depth: 4, up: 'calm, breathe, light, safe', down: 'blood:2, scream:2, whisper, shadow, basement:2, mirror', target: 'scenario', prio: 62, carry: false, show: true, tiers: [{ name: 'steady', from: 12, to: 20, text: 'Describe the house realistically; scares are subtle.' }, { name: 'shaken', from: 6, to: 11, text: 'Small details are wrong: doors left open, whispers at the edge of hearing.' }, { name: 'breaking', from: 0, to: 5, text: 'Reality is slipping. Describe impossible things as if they were ordinary.' }] }];
    M.lorebook.entries = [
      lore({ id: 'basement', keys: 'basement, cellar, downstairs', text: 'The basement door is always locked from the inside.', prio: 20 }),
      lore({ id: 'mirror', keys: 'mirror, reflection', text: 'Reflections in the house lag a fraction of a second behind.', prio: 15 }),
      lore({ id: 'family', keys: 'family, previous owners, who lived here', minMsg: 10, text: 'The Hollins family lived here until 1974. All four vanished on the same night.', prio: 18 })
    ];
    M.random.triggers = [{ keys: 'listen, quiet, hear', chance: 60, target: 'scenario', minMsg: 0, outcomes: 'Three slow knocks from inside the wall. | 2\nA child humming, very faintly, upstairs. | 1\nNothing. Absolute silence, which is worse. | 2' }];
    M.ambient.chance = 15;
    M.ambient.list = [{ text: 'Somewhere a door clicks shut.', weight: 2, periods: 'dusk, night' }, { text: 'The radiator ticks like a slow clock.', weight: 1, periods: '' }, { text: 'Footsteps cross the ceiling, then stop.', weight: 1, periods: 'night' }];
    M.rules.list = [{ name: 'witching_hour', match: 'all', conds: [{ type: 'hour', min: 3, max: 4 }, { type: 'chance', pct: 50 }], text: 'It is the witching hour. Something in the house is standing right behind {{user}}.', target: 'scenario', prio: 85 }];
    return p;
  }

  /* ---------- 4. Trio ensemble ---------- */
  function trio() {
    var p = base('The Night Shift', 'Three coworkers at a 24h diner');
    on(p, ['emotions', 'ensemble', 'states']);
    var M = p.modules;
    M.ensemble.maxActive = 3;
    M.ensemble.budget = 1500;
    var a = JSB.newActor({ id: 'rosa', name: 'Rosa', aliases: 'manager, boss', presence: 'always', snapshot: 'Night manager, 50s, seen it all.', ocean: { O: 0.4, C: 0.9, E: 0.5, A: 0.6, N: 0.2 }, temperament: 'Phlegmatic', speech: { tone: 'Dry', pacing: 'Slow', verbosity: 'Terse', diction: 'Plain', notes: 'calls everyone "hon"' }, quirks: ['Refills coffee without asking', 'Checks watch', 'Sighs through nose'], focus: 40 });
    var b = JSB.newActor({ id: 'dev', name: 'Dev', aliases: 'cook, the cook', presence: 'mentioned', snapshot: 'Line cook, 20s, aspiring stand-up comic.', ocean: { O: 0.9, C: 0.3, E: 0.9, A: 0.6, N: 0.6 }, temperament: 'Sanguine', speech: { tone: 'Playful', pacing: 'Fast', verbosity: 'Chatty', diction: 'Slang', notes: '' }, quirks: ['Uses humor to defuse conflict', 'Talks while flipping things'], focus: 35 });
    var c = JSB.newActor({ id: 'june', name: 'June', aliases: 'waitress, server', presence: 'mentioned', snapshot: 'Server, 19, night-school nursing student.', ocean: { O: 0.6, C: 0.7, E: 0.3, A: 0.9, N: 0.7 }, temperament: 'Melancholic', speech: { tone: 'Gentle', pacing: 'Halting', verbosity: 'Balanced', diction: 'Casual', notes: '' }, quirks: ['Apologizes preemptively', 'Studies flashcards between orders'], focus: 25 });
    a.relations = [JSB.newRelation('user', 'stranger'), JSB.newRelation(b.id, 'mentor'), JSB.newRelation(c.id, 'family')];
    b.relations = [JSB.newRelation('user', 'ally'), Object.assign(JSB.newRelation(c.id, 'lover'), { note: 'Has a crush he jokes about to hide it.' }), JSB.newRelation(a.id, 'ally')];
    c.relations = [JSB.newRelation('user', 'ally'), Object.assign(JSB.newRelation(b.id, 'rival'), { note: 'Pretends his jokes annoy her.' })];
    M.ensemble.cast = [a, b, c];
    M.states.fallback = 'The diner is quiet: a few regulars, the hum of the fridge.';
    M.states.target = 'scenario';
    M.states.list = [{ name: 'Rush', keys: 'busy, rush, crowd, bus', text: 'A tour bus has pulled in. Everyone is slammed and short-tempered.', prio: 2 }];
    return p;
  }

  /* ---------- 6. Dungeon crawl: stats, dice and anti-slop ---------- */
  function dungeon() {
    var p = base('Dungeon crawl', 'The Dungeon Master');
    on(p, ['stats', 'random', 'lorebook', 'pacing', 'memory', 'style', 'rules']);
    var M = p.modules;
    M.stats.list = [
      { name: 'HP', start: 30, min: 0, max: 30, showMax: true, changes: 'drink a potion: 10, healing potion: 10, rest: 5', low: 8, lowText: '{{user}} is badly wounded: describe the pain and make every fight feel dangerous.', enabled: true },
      { name: 'Gold', start: 15, min: 0, max: '', changes: 'buy: -5, pay: -3', enabled: true },
      { name: 'Torches', start: 3, min: 0, max: 9, changes: 'light a torch: -1', low: 0, lowText: 'The torches are gone. The dungeon is pitch black.', enabled: true }
    ];
    M.random.diceTags = true;
    M.random.pool = '1d20 x4, 2d6 x3';
    M.random.triggers = [{ keys: 'search, look around, investigate', chance: 60, target: 'scenario', minMsg: 0, outcomes: 'A loose stone hides 5 gold coins. | 3\nA tripwire, half rotted. | 2\nBones, gnawed recently. | 2\nNothing but dust. | 3', enabled: true }];
    M.lorebook.forms = true;
    M.lorebook.entries = [
      lore({ id: 'goblin', name: 'Goblins', category: 'creature', keys: 'goblin', text: 'Goblins here travel in threes, hate light and flee when one of them falls.', prio: 15 }),
      lore({ id: 'door', name: 'The iron door', category: 'place', keys: 'iron door, door', text: 'The iron door on level two only opens for someone who carries the bone key.', prio: 12 }),
      lore({ id: 'key', name: 'The bone key', category: 'item', keys: 'bone key, key', minMsg: 12, text: 'The bone key is carved from a dragon\'s finger. Touching it makes torches flicker.', prio: 18 })
    ];
    M.pacing.phases = [
      { from: 0, to: 15, target: 'scenario', text: 'Level one: damp tunnels, rats and the odd goblin scout.' },
      { from: 16, to: 40, target: 'scenario', text: 'Level two: older stonework, carvings of a dragon, traps get nastier.' },
      { from: 41, to: 0, target: 'scenario', text: 'The deep level: heat rises from below and something huge is breathing.' }
    ];
    M.pacing.foreshadow = [{ hint: 'a low rumble from far below, like something huge shifting in its sleep', from: 6, chance: 30, payoffAt: 41, payoff: 'The rumbling was a dragon. It is awake now, and it has noticed {{user}}.', target: 'scenario' }];
    M.memory.captureName = true;
    M.memory.capturePrefs = false;
    M.memory.recapEvery = 20;
    M.rules.list = [{ name: 'out_of_gold', match: 'all', conds: [{ type: 'meter', meter: 'Gold', min: 0, max: 0 }, { type: 'keyword', keys: 'buy, shop, merchant', mode: 'any', depth: 1 }], text: '{{user}} has no gold left; merchants refuse credit.', target: 'scenario', prio: 80 }];
    return p;
  }

  /* ---------- 7. Mystery: clues by stage, no spoilers ---------- */
  function mystery() {
    var p = base('Murder at Larkspur Hall', 'Inspector Vale');
    on(p, ['lorebook', 'pacing', 'states', 'memory', 'style']);
    var M = p.modules;
    M.lorebook.forms = true;
    M.lorebook.entries = [
      lore({ id: 'nospoil', name: 'No spoilers', always: true, target: 'personality', text: '{{char}} only knows what has been discovered in the story so far. Never name the culprit or hint at clues that have not been found.', prio: 40 }),
      lore({ id: 'butler', name: 'The butler', category: 'character', keys: 'butler, hobbs', text: 'Hobbs the butler has served the family for 30 years and is fiercely protective of the youngest daughter.', prio: 12 }),
      lore({ id: 'letter', name: 'Burnt letter', category: 'item', keys: 'fireplace, ashes, letter', minMsg: 10, text: 'In the ashes: a half-burnt letter signed "E." begging for money.', prio: 18 }),
      lore({ id: 'eliza', name: 'Eliza', category: 'character', keys: 'eliza, daughter, youngest', minMsg: 20, text: 'Eliza, the youngest daughter, has gambling debts she has hidden from everyone.', prio: 20 })
    ];
    M.pacing.phases = [
      { from: 0, to: 12, target: 'scenario', text: 'Act one: the body has just been found. Everyone is shocked and guarded.' },
      { from: 13, to: 30, target: 'scenario', text: 'Act two: alibis start to crack. Suspects get defensive.' },
      { from: 31, to: 0, target: 'scenario', text: 'Act three: the pieces fit. A confrontation is coming.' }
    ];
    M.pacing.foreshadow = [
      { hint: 'the smell of burnt paper near the study fireplace', from: 2, chance: 40, payoffAt: 10, payoff: 'A servant mentions that someone burned papers in the study the night of the murder.', target: 'scenario' },
      { hint: 'Eliza glancing nervously at the card table', from: 8, chance: 30, payoffAt: 30, payoff: 'Eliza breaks down: she owed money to the victim, but swears she did not kill him.', target: 'scenario' }
    ];
    M.states.list = [{ name: 'Pressed', keys: 'liar, lying, admit it, confess', text: 'The suspect being questioned feels cornered and gets defensive.', escalated: 'The suspect snaps and lets something slip.', escalateAt: 3, prio: 2 }];
    M.memory.recapEvery = 16;
    M.memory.recapText = 'Before your reply, add a short [Case notes] list of the clues found so far (3 to 5 lines).';
    return p;
  }

  /* ---------- 8. Companion: a friendly everyday bot ---------- */
  function companion() {
    var p = base('Everyday companion', '');
    on(p, ['time', 'memory', 'emotions', 'states', 'style']);
    var M = p.modules;
    M.memory.facts = [
      { label: 'job', phrases: 'i work as, my job is, i work at', words: 3, template: '{{user}} works as $1.' },
      { label: 'pet', phrases: 'my dog, my cat, my pet', words: 2, template: '{{user}} has a pet: $1.' }
    ];
    M.memory.recapEvery = 30;
    M.states.list = [
      { name: 'Flustered', keys: 'cute, adorable, pretty, handsome, you look nice', text: '{{char}} gets a little flustered by the compliment.', escalated: '{{char}} is completely flustered and can barely keep a straight face.', escalateAt: 3, prio: 1 },
      { name: 'Comfort', keys: 'bad day, tired, stressed, sad, lonely', text: '{{char}} slows down, listens and offers comfort before anything else.', prio: 3 },
      { name: 'Playful', keys: 'lol, haha, joke, funny, lmao', text: '{{char}} is in a playful mood and jokes back.', prio: 0 }
    ];
    return p;
  }

  function blank() { return base('My Janitor Script', ''); }

  return [
    { id: 'blank', title: 'Blank project', blurb: 'Start from nothing.', make: blank },
    { id: 'tavern', title: 'The Rusty Lantern (every module)', blurb: 'A fantasy tavern that uses all 13 modules. The best tour of what the builder can do.', make: tavern },
    { id: 'slowburn', title: 'Slow-burn romance', blurb: 'Affection meter with tiers, states with escalation, story phases and a late-night rule.', make: slowBurn },
    { id: 'horror', title: 'Horror house', blurb: 'Sanity meter, time-of-day dread, random scares and a witching-hour rule.', make: horror },
    { id: 'trio', title: 'Ensemble trio', blurb: 'Three coworkers with personality sliders, quirks and relationships.', make: trio },
    { id: 'companion', title: 'Everyday companion', blurb: 'A friendly bot that knows the time, remembers your name and likes, reads your mood and avoids clich\u00e9s.', make: companion },
    { id: 'dungeon', title: 'Dungeon crawl (RPG)', blurb: 'HP, gold and torches that last between replies, fresh dice, a foreshadowed dragon and no purple prose.', make: dungeon },
    { id: 'mystery', title: 'Mystery', blurb: 'Clues unlock by stage, hints come before reveals, and the bot never spoils the culprit.', make: mystery }
  ];
});
