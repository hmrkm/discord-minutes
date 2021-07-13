const fs = require('fs');
const { Client } = require('discord.js');
const client = new Client();
const speech = require('@google-cloud/speech');
const speechClient = new speech.v1p1beta1.SpeechClient();
const { WebClient } = require('@slack/web-api');
const slackClient = new WebClient(process.env.SLACK_TOKEN);

const channelId = process.env.CHANNEL_ID
const prefixText = process.env.TEXT_PREFIX.replaceAll("\\n", "\n");
const audioDir = __dirname + "/recordings/"

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
    enter(channelId);
});

const enter = (channelId) => {
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        return console.error("The channel does not exist!");
    }

    let parentTs;
    slackClient.chat.postMessage({
        text: prefixText,
        channel: process.env.TARGET_CHANNEL,
    }).then(result => {
        parentTs = result.ts;
    });

    channel.join()
        .then(conn => {

            console.log(`Joined ${channel.name}!\n\nREADY TO RECORD\n`);

            const receiver = conn.receiver;
            conn.on('speaking', (user, speaking) => {
                if (speaking && speaking.bitfield === 1) {
                    console.log(`${user.username} started speaking`);
                    const audioStream = receiver.createStream(user, { mode: 'pcm' });

                    const now = Date.now();

                    const pathToPcmFile = audioDir + `${now}_${user.id}.pcm`
                    const pathToTxtFile = audioDir + `${now}_${user.id}.txt`

                    audioStream.pipe(recognizeStream(parentTs, user, pathToTxtFile));
                    audioStream.pipe(createNewChunk(pathToPcmFile));

                    audioStream.on('end', () => {
                        console.log(`${user.username} stopped speaking`);
                        // if (fs.existsSync(pathToPcmFile)) {
                        //     console.log(pathToPcmFile + " is exist");
                        // }
                        // if (fs.existsSync(pathToTxtFile)) {
                        //     console.log(pathToTxtFile + " is exist");
                        // }
                    });
                }
            });
        })
        .catch(err => {
            console.log(err);
        });
}

const exit = (channelId) => {
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        return console.error("The channel does not exist!");
    }

    channel.leave();
    console.log(`\nSTOPPED RECORDING\n`);
};

const recognizeStream = (parentTs, user, pathToFile) => {
    return speechClient
        .streamingRecognize(stt_request)
        .on('error', console.error)
        .on('data', (data) => {
            if (data.error === null) {
                const speech = `${user.username} : ${data.results[0].alternatives[0].transcript}`;
                console.log(speech);
                slackClient.chat.postMessage({
                    text: speech,
                    channel: process.env.TARGET_CHANNEL,
                    thread_ts: parentTs,
                });

                try {
                    fs.writeFileSync(pathToFile, speech);
                } catch (e) {
                    console.log(e);
                }
            }
        });
};

const createNewChunk = (pathToFile) => {
    return fs.createWriteStream(pathToFile);
};

var reader = require("readline").createInterface({
    input: process.stdin,
});

reader.on("line", (line) => {
    if (line === "enter") {
        enter(channelId);
    }
    if (line === "exit") {
        exit(channelId);
    }
});
