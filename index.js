const fs = require('fs');
const { Client } = require('discord.js');
const client = new Client();
const speech = require('@google-cloud/speech');
const speechClient = new speech.v1p1beta1.SpeechClient();
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_TOKEN);

const prefix = process.env.PREFIX;

const SAMPLE_RATE = 48000;
const stt_request = {
    config: {
        encoding: 'LINEAR16', // signed 16bit PCM
        sampleRateHertz: SAMPLE_RATE, // 48kHz
        languageCode: 'ja-jp',
    }
};

client.login(process.env.DICORD_BOT_TOKEN);

client.on('ready', () => {
    console.log('I am ready!');
});

const prefixText = process.env.TEXT_PREFIX.replaceAll("\\n", "\n");

let text = prefixText;

client.on('message', msg => {
    if (msg.content.startsWith(prefix)) {
        const commandBody = msg.content.substring(prefix.length).split(' ');
        const channelName = commandBody[1];

        if (commandBody[0] === ('enter') && commandBody[1]) enter(msg, channelName);
        if (commandBody[0] === ('exit')) exit(msg);
    }
});

const enter = (msg, channelName) => {
    channelName = channelName.toLowerCase();

    //filter out all channels that aren't voice or stage
    const voiceChannel = msg.guild.channels.cache
        .filter(c => c.type === "voice" || c.type === "stage")
        .find(channel => channel.name.toLowerCase() === channelName);

    //if there is no voice channel at all or the channel is not voice or stage
    if (!voiceChannel || (voiceChannel.type !== 'voice' && voiceChannel.type !== 'stage'))
        return msg.reply(`The channel #${channelName} doesn't exist or isn't a voice channel.`);

    console.log(`Sliding into ${voiceChannel.name} ...`);
    voiceChannel.join()
        .then(conn => {

            console.log(`Joined ${voiceChannel.name}!\n\nREADY TO RECORD\n`);

            const receiver = conn.receiver;
            conn.on('speaking', (user, speaking) => {
                if (speaking && speaking.bitfield === 1) {
                    console.log(`${user.username} started speaking`);
                    const audioStream = receiver.createStream(user, { mode: 'pcm' });

                    const recognizeStream = speechClient.streamingRecognize(stt_request)
                        .on('error', console.error)
                        .on('data', (data) => {
                            if (data.error === null) {
                                const speach = `${user.username} : ${data.results[0].alternatives[0].transcript}`;
                                console.log(speach);
                                text += speach + "\n"
                            }
                        });
                    audioStream.pipe(recognizeStream);
                    // audioStream.pipe(createNewChunk());

                    audioStream.on('end', () => { console.log(`${user.username} stopped speaking`); });
                }
            });
        })
        .catch(err => { throw err; });
};

const exit = (msg) => {
    //check to see if the voice cache has any connections and if there is
    //no ongoing connection (there shouldn't be undef issues with this).
    if (msg.guild.voiceStates.cache.filter(a => a.connection !== null).size !== 1)
        return;

    slackClient.chat.postMessage({
        text: text,
        channel: process.env.TARGET_CHANNEL,
    });
    console.log(text);
    text = prefixText;

    //make sure it's .last() not .first().  some discord js magic going on rn
    const { channel: voiceChannel, connection: conn } = msg.guild.voiceStates.cache.last();
    if (voiceChannel === null) {
        console.log(msg.guild.voiceStates.cache);
        console.log("voiceChannel is null");
    } else {
        voiceChannel.leave();
        console.log(`\nSTOPPED RECORDING\n`);
    }
};

const createNewChunk = () => {
    const pathToFile = __dirname + `/recordings/${Date.now()}.pcm`;
    return fs.createWriteStream(pathToFile);
};
