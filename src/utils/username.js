import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Modern social media style username components (Gen Z / TikTok style)
const casualPrefixes = [
  'im_', 'its', 'not', 'ayoo_', 'lil', 'ur', 'wait4', 'chillwith',
  'lowkey', 'notfound_', 'just_', 'wassup', 'kinda_', 'heyits',
  'idk', 'ayo_', 'sleepy', 'yoits', 'bruh', 'callme',
  'whois', 'itsme', 'yo_', 'fr_', 'ngl_', 'wya_', 'tbh_',
  'literally', 'actually', 'basically', 'clearly', 'obviously',
  'perhaps', 'maybe', 'probably', 'slightly', 'kinda',
  'sorta', 'totally', 'really', 'honestly', 'truly'
];

const casualSuffixes = [
  'fr', 'ngl', 'wya', 'tbh', 'ong', 'frfr', 'notfound_',
  'butbetter', 'vibes', 'energy', 'szn', 'era', 'core',
  'mode', '_tho', 'rn', 'always', 'forever', 'never',
  'maybe', 'probably', 'definitely', 'actually', 'really',
  'truly', 'honestly', 'literally', 'officially', 'originally'
];

const modernNames = [
  // Popular modern first names
  'kai', 'adam', 'leon', 'nathan', 'jay', 'mason', 'nina', 'sam',
  'ryan', 'noah', 'eli', 'zane', 'asher', 'kiara', 'ellie', 'luca',
  'mila', 'josh', 'sky', 'devin', 'aria', 'hazel', 'kian', 'luke',
  'leo', 'nora', 'evan', 'sophie', 'alex', 'jade', 'max', 'luna',
  'finn', 'ivy', 'cole', 'zoe', 'owen', 'ruby', 'miles', 'sage',
  'jace', 'nova', 'blake', 'willow', 'jude', 'isla', 'ezra', 'maya',
  'dean', 'chloe', 'abel', 'piper', 'knox', 'river', 'cruz', 'autumn',
  'ace', 'violet', 'arlo', 'hazel', 'gray', 'scarlett', 'dash', 'aurora',
  'sean', 'daisy', 'tate', 'iris', 'rowan', 'olive', 'beck', 'poppy',
  'rex', 'lucy', 'cash', 'ella', 'reed', 'rose', 'knox', 'grace'
];

const modernVariations = [
  'with2y', 'with3e', 'but3t', 'notlucas', 'notluca', 'notkiara',
  'itsluca', 'itslucy', 'itsella', 'itsgrace', 'itsnova', 'itsjade',
  'bro', 'dude', 'guy', 'kid', 'boy', 'girl', 'fav', 'best',
  'real', 'fake', 'actual', 'true', 'false', 'new', 'old', 'young',
  'rrr_', 'yyy_', 'eee_', '2x', '3x', 'x2', 'x3'
];

// Classic mystical/fantasy style for variety
const classicPrefixes = [
  'Ancient', 'Mystic', 'Cosmic', 'Silent', 'Crystal',
  'Eternal', 'Shadow', 'Storm', 'Frost', 'Ember',
  'Void', 'Astral', 'Lunar', 'Solar', 'Divine',
  'Chaos', 'Dream', 'Spirit', 'Star', 'Night',
  'Dawn', 'Dusk', 'Wild', 'Iron', 'Dark',
  'Light', 'Thunder', 'Flame', 'Ice', 'Wind'
];

const classicNouns = [
  'Phoenix', 'Dragon', 'Raven', 'Wolf', 'Serpent',
  'Guardian', 'Warrior', 'Knight', 'Hunter', 'Mage',
  'Titan', 'Oracle', 'Prophet', 'Sage', 'Nomad',
  'Wanderer', 'Seeker', 'Warden', 'Sentinel', 'Scout',
  'Champion', 'Herald', 'Keeper', 'Walker', 'Slayer'
];

class UsernameManager {
  constructor() {
    this.usedNamesFile = path.join(__dirname, '../../used_usernames.json');
    this.usedNames = this.loadUsedNames();
    this.maxStoredNames = 1000; // Limit stored names to prevent file growth
  }

  loadUsedNames() {
    try {
      if (fs.existsSync(this.usedNamesFile)) {
        return JSON.parse(fs.readFileSync(this.usedNamesFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading used names:', error);
    }
    return [];
  }

  saveUsedNames() {
    try {
      // Keep only the most recent names
      if (this.usedNames.length > this.maxStoredNames) {
        this.usedNames = this.usedNames.slice(-this.maxStoredNames);
      }
      fs.writeFileSync(this.usedNamesFile, JSON.stringify(this.usedNames, null, 2));
    } catch (error) {
      console.error('Error saving used names:', error);
    }
  }

  generateCombinedName() {
    const rand = Math.random();
    
    // 70% modern/casual style, 30% classic fantasy style
    if (rand < 0.7) {
      // Modern casual patterns like TikTok/social media usernames
      const patterns = [
        // im_justkai, its_adam, not_leo
        () => {
          const prefix = this.getRandomElement(casualPrefixes);
          const name = this.getRandomElement(modernNames);
          return prefix + (prefix.endsWith('_') ? '' : '_') + 'just' + name;
        },
        // bro_itsadam, dude_itsjay
        () => {
          const word = this.getRandomElement(['bro', 'dude', 'yo', 'hey']);
          const name = this.getRandomElement(modernNames);
          return word + '_its' + name;
        },
        // notleonfr, noahnotfound_, ayoo_nathan
        () => {
          const prefix = this.getRandomElement(casualPrefixes);
          const name = this.getRandomElement(modernNames);
          const suffix = Math.random() < 0.5 ? this.getRandomElement(casualSuffixes) : '';
          const sep = prefix.endsWith('_') ? '' : (suffix.startsWith('_') ? '' : (Math.random() < 0.3 ? '_' : ''));
          return prefix + sep + name + suffix;
        },
        // urfavmason, urbestkai
        () => {
          const word = Math.random() < 0.5 ? 'fav' : 'best';
          const name = this.getRandomElement(modernNames);
          return 'ur' + word + name;
        },
        // wait4nina, chillwithsam
        () => {
          const prefix = this.getRandomElement(['wait4', 'chillwith', 'vibeswith']);
          const name = this.getRandomElement(modernNames);
          return prefix + name;
        },
        // lowkeyryan, kinda_asher
        () => {
          const word = this.getRandomElement(['lowkey', 'kinda', 'sorta', 'maybe']);
          const name = this.getRandomElement(modernNames);
          const sep = Math.random() < 0.3 ? '_' : '';
          return word + sep + name;
        },
        // just_eli_tho, literally_jay
        () => {
          const name = this.getRandomElement(modernNames);
          const suffix = this.getRandomElement(['_tho', '_fr', '_ngl', '']);
          return 'just_' + name + suffix;
        },
        // heyitskiara, yoitskian
        () => {
          const prefix = this.getRandomElement(['heyits', 'yoits', 'itsme']);
          const name = this.getRandomElement(modernNames);
          return prefix + name;
        },
        // elliefr_, idkitsluca
        () => {
          const name = this.getRandomElement(modernNames);
          const suffix = this.getRandomElement(['fr_', 'ngl_', 'tbh_', 'ong_']);
          return name + suffix;
        },
        // sleepyjoshh, chillysamm (double letter variation)
        () => {
          const adj = this.getRandomElement(['sleepy', 'chilly', 'happy', 'crazy', 'lazy']);
          const name = this.getRandomElement(modernNames);
          const lastChar = name[name.length - 1];
          return adj + name + (Math.random() < 0.5 ? lastChar : '');
        },
        // skyywith2y, devinwya (letter variations)
        () => {
          const name = this.getRandomElement(modernNames);
          const variations = ['with2y', 'with3e', 'wya', 'fr', 'rn'];
          const variant = this.getRandomElement(variations);
          // Some variations double letters
          if (variant.includes('2')) {
            const doubled = name[0] + name[0] + name.slice(1);
            return doubled + variant;
          }
          return name + variant;
        },
        // lukeynotlucas, kaibutbetter
        () => {
          const name = this.getRandomElement(modernNames);
          const otherName = this.getRandomElement(modernNames.filter(n => n !== name));
          const connector = this.getRandomElement(['not', 'but']);
          const suffix = connector === 'not' ? otherName : 'better';
          return name + (Math.random() < 0.3 ? 'y' : '') + connector + suffix;
        },
        // callmeevan, asherrr_ (emphasis variations)
        () => {
          const name = this.getRandomElement(modernNames);
          const prefix = Math.random() < 0.5 ? 'callme' : '';
          const lastChar = name[name.length - 1];
          const emphasis = Math.random() < 0.5 ? lastChar + lastChar + '_' : '';
          return prefix + name + emphasis;
        },
        // whosaria_, itsmehazel
        () => {
          const prefix = this.getRandomElement(['whos', 'wheres', 'whys']);
          const name = this.getRandomElement(modernNames);
          const suffix = Math.random() < 0.4 ? '_' : '';
          return prefix + name + suffix;
        },
        // sophiewyd (what you doing)
        () => {
          const name = this.getRandomElement(modernNames);
          const abbrev = this.getRandomElement(['wyd', 'wya', 'rn', 'fr', 'ngl']);
          return name + abbrev;
        }
      ];
      
      return this.getRandomElement(patterns)();
    } else {
      // Classic fantasy style patterns
      const patterns = [
        () => this.getRandomElement(classicPrefixes) + this.getRandomElement(classicNouns),
        () => this.getRandomElement(classicNouns) + Math.floor(Math.random() * 999),
        () => this.getRandomElement(modernNames) + this.getRandomElement(classicNouns)
      ];
      
      return this.getRandomElement(patterns)();
    }
  }

  getRandomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  getUsername(config) {
    if (!config.bot.useRandomUsername) {
      return config.bot.username;
    }

    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
      const name = this.generateCombinedName();
      
      // Ensure name meets Minecraft username requirements
      if (name.length >= 3 && name.length <= 16 && /^[a-zA-Z0-9_]+$/.test(name)) {
        if (!this.usedNames.includes(name)) {
          this.usedNames.push(name);
          this.saveUsedNames();
          return name;
        }
      }
      
      attempts++;
    }

    // If we've used too many names or can't find a unique one, generate a fallback
    const timestamp = Date.now().toString(36);
    const randomSuffix = Math.random().toString(36).substring(2, 5);
    const fallbackName = `Player${timestamp}${randomSuffix}`;
    
    this.usedNames.push(fallbackName);
    this.saveUsedNames();
    return fallbackName;
  }
}

export const usernameManager = new UsernameManager();