const { Client, GatewayIntentBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const ytdl = require('ytdl-core');
const SpotifyUrlInfo = require('spotify-url-info');

// Load environment variables
require('dotenv').config();

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
  if (message.author.bot) return;

  const args = message.content.split(' ');
  const command = args[0].toLowerCase();

  if (command === '!play') {
    const url = args.slice(1).join(' ');
    if (isSpotifyUrl(url)) {
      playSpotify(message, url);
    } else {
      playYouTube(message, url);
    }
  } else if (command === '!skip') {
    skip(message);
  } else if (command === '!stop') {
    stop(message);
  } else if (command === '!casino') {
    casino(message);
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

  const songInfo = ytdl.getInfo(url, { filter: 'audioonly' }, (error, info) => {
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

const commands = [
  {
    name: 'play',
    description: 'Play a Spotify or YouTube song.',
    type: 1,
    options: [
      {
        name: 'url',
        description: 'The Spotify or YouTube URL or search query.',
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: 'skip',
    description: 'Skip the currently playing song.',
    type: 1,
  },
  {
    name: 'stop',
    description: 'Stop the music and disconnect from the voice channel.',
    type: 1,
  },
  {
    name: 'casino',
    description: 'Roll a six-sided die in the casino.',
    type: 1,
  },
];

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
