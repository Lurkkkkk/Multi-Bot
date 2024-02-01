const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const ytdl = require('ytdl-core');
const SpotifyUrlInfo = require('spotify-url-info');
const prefixFilePath = './prefix.json';
const dataFilePath = './data.json';

// Load or initialize data
let data = {};

try {
  if (fs.existsSync(dataFilePath)) {
    const jsonData = fs.readFileSync(dataFilePath, 'utf-8');
    if (jsonData.trim() !== '') {
      data = JSON.parse(jsonData);
    }
  }
} catch (error) {
  console.error('Error reading data file:', error.message);
}

// Update user balance
function updateUserBalance(userId, amount) {
  data[userId] = data[userId] || { balance: 0, blackjackWins: 0, blackjackLosses: 0, rouletteWins: 0, rouletteLosses: 0, slotsWins: 0, slotsLosses: 0 };
  data[userId].balance += amount;
}

// Update game statistics
function updateGameStats(userId, gameType, win) {
  data[userId] = data[userId] || { balance: 0, blackjackWins: 0, blackjackLosses: 0, rouletteWins: 0, rouletteLosses: 0, slotsWins: 0, slotsLosses: 0 };

  if (win) {
    data[userId][`${gameType}Wins`] += 1;
  } else {
    data[userId][`${gameType}Losses`] += 1;
  }
}

// Save data to file
function saveDataToFile() {
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing to data file:', error.message);
  }
}

// Load environment variables
require('dotenv').config();

// Initialize the prefix
let prefix; // No default prefix

// Check if the prefix file exists
if (fs.existsSync(prefixFilePath)) {
  // Load the prefix from the file
  const prefixData = fs.readFileSync(prefixFilePath);
  prefix = JSON.parse(prefixData).prefix;
} else {
  // If the file doesn't exist, use a default prefix
  prefix = '!';
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

const rest = new REST({ version: '9' }).setToken(process.env.BOT_TOKEN);

const queue = new Map();

client.once('ready', () => {
  console.log('Bot is online!');
});

client.on('messageCreate', async (message) => {
  // Example usage in your event handler
  const userId = message.author.id;

  // Update user balance (example: deduct 10 from balance)
  updateUserBalance(userId, -10);

  // Update game statistics (example: user won in blackjack)
  updateGameStats(userId, 'blackjack', true);

  // Save data to file
  saveDataToFile();

  // Rest of your command handling code remains unchanged
  const args = message.content.slice(prefix.length).split(' ');
  const command = args[0].toLowerCase();  // Initialize the command variable

  if (command === 'play') {
    const url = args.slice(1).join(' ');
    if (isSpotifyUrl(url)) {
      playSpotify(message, url);
    } else {
      playYouTube(message, url);
    }
  } else if (command === 'skip') {
    skip(message);
  } else if (command === 'stop') {
    stop(message);
  } else if (command === 'casino') {
    casino(message);
  } else if (command === 'roulette') {
    playRoulette(message, args);
  } else if (command === 'blackjack') {
    playBlackjack(message);
  } else if (command === 'slots') {
    playSlots(message);
  } else if (command === 'setprefix' && message.member.permissions.has('ADMINISTRATOR')) {
    // Check if the user has the necessary permissions to change the prefix
    if (!args[1]) return message.channel.send('Please provide a new prefix.');

    // Update the prefix
    prefix = args[1];

    // Save the new prefix to the file
    fs.writeFileSync(prefixFilePath, JSON.stringify({ prefix }));

    return message.channel.send(`Prefix updated to: ${prefix}`);
  }
});

function isSpotifyUrl(url) {
  return url.includes('open.spotify.com');
}

async function playSpotify(message, url) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return message.channel.send('You need to be in a voice channel to play music!');
  }

  try {
    const songInfo = await SpotifyUrlInfo.getPreview(url);
    const song = {
      title: songInfo.title,
      url: songInfo.preview_url,
    };

    handleSong(message, voiceChannel, song);
  } catch (error) {
    console.error(`Error fetching Spotify data: ${error.message}`);
    return message.channel.send(`Error: ${error.message}`);
  }
}

function playYouTube(message, url) {
  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return message.channel.send('You need to be in a voice channel to play music!');
  }

  ytdl.getInfo(url, { filter: 'audioonly' }, (error, info) => {
    if (error) {
      console.error(`Error fetching YouTube data: ${error}`);
      return message.channel.send(`Error: ${error.message}`);
    }

    const song = {
      title: info.title,
      url: url,
    };

    handleSong(message, voiceChannel, song);
  });
}

async function handleSong(message, voiceChannel, song) {
  const serverQueue = queue.get(message.guild.id);

  if (!serverQueue) {
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: [],
      volume: 5,
      playing: true,
    };

    queue.set(message.guild.id, queueConstruct);
    queueConstruct.songs.push(song);

    try {
      const connection = await voiceChannel.join();
      queueConstruct.connection = connection;
      play(message.guild, queueConstruct.songs[0]);
    } catch (error) {
      console.error(`Error joining voice channel: ${error}`);
      queue.delete(message.guild.id);
      return message.channel.send(`Error: ${error.message}`);
    }
  } else {
    serverQueue.songs.push(song);
    return message.channel.send(`${song.title} has been added to the queue!`);
  }
}

function skip(message) {
  const serverQueue = queue.get(message.guild.id);
  if (serverQueue) {
    serverQueue.connection.dispatcher.end();
  }
}

function stop(message) {
  const serverQueue = queue.get(message.guild.id);
  if (serverQueue) {
    serverQueue.songs = [];
    serverQueue.connection.dispatcher.end();
  }
}

function play(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.voiceChannel.leave();
    queue.delete(guild.id);
    return;
  }

  const dispatcher = serverQueue.connection
    .play(ytdl(song.url, { filter: 'audioonly' }))
    .on('finish', () => {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    })
    .on('error', (error) => console.error(error));

  dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
  serverQueue.textChannel.send(`Now playing: **${song.title}**`);
}

function casino(message) {
  const result = Math.floor(Math.random() * 6) + 1;
  message.channel.send(`You rolled a ${result}!`);
}

function playRoulette(message, args) {
  if (args.length < 1) {
    return message.channel.send('Please provide a valid bet: `red`, `black`, `green`, or a number (0-36).');
  }

  const bet = args[0].toLowerCase();
  const validBets = ['red', 'black', 'green'];

  let result = Math.floor(Math.random() * 37); // Generate a random number for the result

  if (!isNaN(bet)) {
    const numberBet = parseInt(bet, 10);

    if (numberBet < 0 || numberBet > 36) {
      return message.channel.send('Please provide a valid bet: `red`, `black`, `green`, or a number (0-36).');
    }

    message.channel.send(`🎰 The roulette wheel spins... The result is: ${result}`);
  } else if (validBets.includes(bet)) {
    message.channel.send(`🎰 The roulette wheel spins... The result is: ${result}`);
  } else {
    return message.channel.send('Please provide a valid bet: `red`, `black`, `green`, or a number (0-36).');
  }

  const betAmount = 10; // Set a default bet amount (you can adjust this as needed)
  const payoutMultiplier = 0;
  const winnings = betAmount * payoutMultiplier;

  if (payoutMultiplier > 0) {
    updateUserBalance(message.author.id, winnings);
    message.channel.send(`🎰 The roulette wheel spins... The result is: ${result}. Congratulations! You win ${winnings} coins!`);
  } else {
    updateUserBalance(message.author.id, -betAmount);
    message.channel.send(`🎰 The roulette wheel spins... The result is: ${result}. Better luck next time! You lose ${betAmount} coins.`);
  }
}

function playBlackjack(message) {
  const player = createPlayer();
  const dealer = createPlayer();

  // Initial deal
  dealCard(player);
  dealCard(dealer);
  dealCard(player);
  dealCard(dealer);

  const playerHand = calculateHand(player);
  const dealerHand = calculateHand(dealer);

  message.channel.send(`Your hand: ${handToString(player)} (Total: ${playerHand})`);
  message.channel.send(`Dealer's hand: ${handToString(dealer)} (Total: ${dealerHand})`);

  if (playerHand === 21) {
    message.channel.send('🎉 Blackjack! You win!');
  } else {
    message.channel.send('❓ Type `hit` to get another card or `stand` to stop.');
  }
}

function playSlots(message) {
  const emojis = ['🍒', '🍇', '🍊', '🍋', '🍉', '🍓', '🍎', '🍏'];
  const slot1 = getRandomElement(emojis);
  const slot2 = getRandomElement(emojis);
  const slot3 = getRandomElement(emojis);

  message.channel.send(`**Slots:** ${slot1} | ${slot2} | ${slot3}`);

  if (slot1 === slot2 && slot2 === slot3) {
    message.channel.send('🎉 Jackpot! You win!');
  } else {
    message.channel.send('😞 Sorry, try again!');
  }
}

function createPlayer() {
  return {
    hand: [],
  };
}

function dealCard(player) {
  const card = getRandomCard();
  player.hand.push(card);
}

function getRandomCard() {
  const cards = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  return getRandomElement(cards);
}

function getRandomElement(array) {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

function calculateHand(player) {
  const values = player.hand.map(getCardValue);
  const sum = values.reduce((total, value) => total + value, 0);

  // Handle Ace as 1 or 11
  const numAces = values.filter((value) => value === 11).length;
  for (let i = 0; i < numAces && sum > 21; i++) {
    sum -= 10;
  }

  return sum;
}

function getCardValue(card) {
  if (card === 'K' || card === 'Q' || card === 'J') {
    return 10;
  } else if (card === 'A') {
    return 11; // Ace can be 11 or 1, depending on the hand
  } else {
    return parseInt(card, 10);
  }
}

function handToString(player) {
  return player.hand.join(' ');
}

// Define the commands for your application (/) commands
const commands = [
  {
    name: 'ping',
    description: 'Replies with Pong!',
  },
  // Add more commands as needed
];

// Inside the message event handler
if (command === 'blackjack') {
  playBlackjack(message);
} else if (command === 'roulette') {
  playRoulette(message, args);
} else if (command === 'slots') {
  playSlots(message);
}

(async () => {
  try {
    console.log('Started refreshing global application (/) commands.');

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    console.log('Successfully reloaded global application (/) commands.');
  } catch (error) {
    console.error(error);
  }
})();

client.login(process.env.BOT_TOKEN);
