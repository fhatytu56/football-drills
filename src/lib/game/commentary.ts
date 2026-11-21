// Match commentary lines. Placeholders:
//   {p} our player on the ball / shooting   {a} our player who helps (pass, cross)
//   {d} one of our defenders                {k} our keeper
//   {t} the other team                      {o} one of their players ("their number 7")
//   {T} same as {o} but capitalised for the start of a sentence

export const GOAL_US = [
  '{a} threads it through, {p} rounds the keeper… GOAL!',
  '{p} picks it up on halfway, beats one, beats two… GOAL! What a run!',
  'Corner from {a}, {p} gets there first… GOAL!',
  '{p} from the edge of the box… top corner! GOAL!',
  'Scramble in the box… {p} pokes it home! GOAL!',
  '{a} crosses low, {p} slides in at the back post. GOAL!',
  '{p} nutmegs the defender and slots it in. GOAL! Cheeky!',
  'One-two between {a} and {p}… {p} finishes! GOAL!',
  '{p} chases a lost cause, nicks it off the keeper — GOAL!',
  'Free kick… {p} curls it over the wall! GOAL!',
  '{p} hits it first time on the volley! GOAL! Get in!',
  '{p} with a cheeky chip over the keeper. GOAL!',
  'The keeper spills it and {p} is there to tap in. GOAL!',
  '{k} launches it long, {p} runs onto it and buries it! GOAL!',
  '{p} smashes it in off the underside of the bar! GOAL!',
];

export const GOAL_THEM = [
  '{T} skips past two and finishes. Goal for {t}.',
  '{t} break quickly and {o} slots it past {k}.',
  '{T} curls one in from distance. {k} had no chance.',
  'Corner for {t}… flicked in at the near post.',
  '{t} pass it around us and {o} taps in.',
  '{T} with a lovely finish. Goal for {t}.',
  'Mix-up at the back and {t} pounce.',
  'A deflection wrong-foots {k}. Goal for {t}.',
  '{T} goes on a run nobody can stop. Goal for {t}.',
];

export const SAVE_BY_THEM = [ // our shot, their keeper saves
  '{p} shoots… saved!',
  '{p} forces a great save from their keeper.',
  '{p} tries the far corner. Their keeper tips it round the post.',
  '{a} lays it off for {p}… straight at the keeper.',
  '{p} goes low and hard. Kept out!',
  'Header from {p}! Their keeper claws it away.',
  '{p} with a long-range effort. Comfortable for the keeper.',
  '{p} one-on-one… the keeper spreads himself and saves!',
];

export const MISS_US = [
  '{p} shoots… just wide!',
  '{p} blazes it over the bar.',
  '{p} hits the post! So close!',
  '{p} smacks the crossbar!',
  '{p} gets it caught under the feet. Chance gone.',
  '{p} takes one touch too many and it’s blocked.',
  '{a} pulls it back for {p}, who scuffs it wide.',
  '{p} goes for the spectacular. It’s gone into the next pitch.',
];

export const SAVE_BY_US = [ // their shot, our keeper (or a defender) stops it
  '{t} shoot — great save from {k}!',
  '{k} dives full stretch to stop {o}.',
  '{k} gets down well to save.',
  'Fingertip save from {k}! Brilliant!',
  '{k} spreads big and blocks it.',
  '{d} clears it off the line!',
  '{k} catches it cleanly. No problem.',
  '{d} throws a leg in and blocks the shot.',
];

export const MISS_THEM = [
  '{T} shoots wide for {t}.',
  '{t} go close but it’s off target.',
  '{T} hits the side netting.',
  '{T} skies it. The ball is somewhere in the car park.',
  '{t} hit the post! Lucky escape.',
  '{T} pulls it wide under pressure from {d}.',
];

export const PLAY_US = [
  '{p} keeps it moving.',
  'Nice pass from {p}.',
  '{p} switches the play.',
  'Lovely first touch from {p}.',
  '{p} drives forward with the ball.',
  '{p} drops a shoulder and gets past a defender.',
  '{k} rolls it out to {a}.',
  'Patient passing at the back from {d} and {a}.',
  '{a} finds {p} with a clever pass.',
  '{p} wins a corner. Cleared.',
  'Throw-in for us. {a} takes it quickly.',
  '{p} holds it up and waits for support.',
  '{p} skips past a tackle down the wing.',
  'Neat triangle between {d}, {a} and {p}.',
  '{p} tries a cross. Too long.',
  '{p} shields the ball like a pro.',
];

export const PLAY_THEM = [
  '{t} on the ball.',
  'Good tackle from {d}.',
  '{d} reads it and intercepts.',
  '{k} comes off the line to claim it.',
  '{t} win a corner. {d} heads it clear.',
  '{t} go long. {d} gets there first.',
  '{p} tracks back well to win it.',
  'Throw-in to {t}.',
  '{t} pressing high.',
  '{t} knocking it around at the back.',
  '{d} sticks a foot in. Clean tackle!',
  '{T} tries a dribble. {d} isn’t having it.',
];

export function fill(line: string, v: Record<string, string>) {
  return line.replace(/\{([a-zA-Z])\}/g, (_, k: string) => v[k] ?? '');
}
