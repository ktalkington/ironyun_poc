import 'dotenv/config';
import { gql, GraphQLClient } from 'graphql-request';
import glob from 'glob-promise';
import axios from 'axios';
import FormData from 'form-data';
import { URLSearchParams } from 'url';
import path from 'path';
import { promises as fs } from 'fs';

const username = process.env['USERNAME'];
const password = process.env['PASSWORD'];
const API_BASE_URL = process.env['API_BASE'];
const cameraUuid = process.env['CAMERA_UUID'];
const assetPath = process.env['ASSET_PATH'];
const cameraDelete = toBoolean(process.env['CAMERA_DELETE'])

const client = axios.create({
    baseURL: API_BASE_URL,
    header: {
        'X-Auth-Token': '',
        'Content-Type': 'application/json'
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

let token = '';

const sleep = async (milliseconds) => {
    await new Promise(resolve => {
        return setTimeout(resolve, milliseconds)
    });
};

const toBoolean = (dataStr) => {
    return !!(dataStr?.toLowerCase?.() === 'true' || dataStr === true || Number.parseInt(dataStr, 10) === 1);
  };

const getDate = () => {
    // yyyyMMddHHmmss
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = now.getMonth().toString().padStart(2, '0');
    const day = now.getDay().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    // console.log(year + month + day + hours + minutes + seconds);
    return year + month + day + hours + minutes + seconds;
}

const padTo2Digits = (num) => {
    return num.toString().padStart(2, '0');
  }
  
  const formatDate = (date) => {
    return (
      [
        date.getFullYear(),
        padTo2Digits(date.getMonth() + 1),
        padTo2Digits(date.getDate()),
      ].join('-') +
      ' ' +
      [
        padTo2Digits(date.getHours()),
        padTo2Digits(date.getMinutes()),
        padTo2Digits(date.getSeconds()),
      ].join(':')
    );
  }

const getToken = async () => {
    try {
        const {data} = await client.post('/auth', {
            username,
            password
        });
        if (data) {
            return data.token;
        }
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}

const fetchtPseudoCamera = async(uuid) => {
    let data;
    try {
        const { data: cameras } = await client.get('/cameras');
        // console.log(cameras);
        const foundCamera = cameras.content.find(camera => camera.name.includes(cameraUuid));
        // console.log(foundCamera);
        if (foundCamera) return foundCamera;

        console.log(`No Camera matching ${cameraUuid} found.  Creating new camera...`);
        const { data: newCamera } = await client.post('/cameras/pseudo', {
            name: `VideoSource Pseudo - ${cameraUuid}`,
            description: 'Pseudo Camera for Engine usage'
        });
        if (newCamera) return newCamera;
        throw new Error('No Cameras Available');
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}

const removePseudoCamera = async(uuid) => {
    try {
        await client.delete(`/cameras/${uuid}`);
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}

const submitJob = async (cameraId, asset) => {
    try {
        const video = await fs.readFile(asset);
        const form = new FormData();
        const usrFileName = path.basename(asset);
        form.append('file', video, usrFileName);
        // jobs?type=UploadJob&cameraId=199&startTime=20210514180100&usrFileName=LPR_Test_1a&engineProfileId=1&endTime=20210514170105
        //            &description=TEST&plugins=VideoSearch,LPREngine,VehicleCountingEngine&doTranscode=True
        const params = new URLSearchParams({
            type: 'UploadJob',
            cameraId,
            engineProfileId: 7,
            startTime: getDate(),
            usrFileName,
            description: 'LPR Test',
            // description: 'FR Test',
            plugins: 'VideoSearch,LPREngine,VehicleCountingEngine,MakeModelRecognitionEngine',
            // plugins: 'FaceRecognitionEngine,PeopleCountingEngine',
            doTranscode: true
        })
        const { data } = await client.post(`/jobs?${params}`, form);
        if (data) {
            const regex1 = RegExp(/Job created\s:\s(\d+)/, 'g');
            const [match, jobId] = regex1.exec(data.message);
            console.log('Job ID', jobId)
            let response = await client.get(`/jobs/${jobId}`);
            let jobStatus = response.data.status;
            let footageId = response.data.footageId;
            const statuses = ['Completed', 'Failed', 'Unknown', 'FailedRetry']
            while (!statuses.includes(jobStatus)) {
                console.log('Job Status:', jobStatus)
                await sleep(5000);
                response = await client.get(`/jobs/${jobId}`);
                jobStatus = response.data.status;
                switch(jobStatus) {
                    case 'Waiting':
                    case 'Running':
                        console.log('Still processing, please be patient...')
                        break;
                    case 'Completed':
                        console.log(jobStatus)
                        return footageId;
                    case 'Canceled':
                    case 'Suspended':
                    case 'Failed':
                    case 'FailedRetry':
                    case 'Unknown':
                        console.log(`Something went wrong - Status: ${jobStatus}`)
                        break;
                }
            }
            return footageId;
        }
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}
const fetchFootage = async (id) => {
    try {
        const { data } = await client.get(`/footages/${id}`);
        if (data) {
            return data;
        }
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}

const fetchPlates = async (id, startTime, endTime) => {
    try {
        const params = new URLSearchParams({
            start: startTime,
            end: endTime,
            footageIds: id
        })
        const { data } = await client.get(`/lpr/plates?${params}`);
        if (data) {
            return data;
        }
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}

const fetchFaceMatches = async (id, categories, startTime, endTime) => {
    try {
        const params = new URLSearchParams({
            start: startTime,
            end: endTime,
            footageIds: id,
            categories
        })
        const { data } = await client.get(`/face/matches?${params}`);
        if (data) {
            return data;
        }
    } catch(err) {
        console.error(err)
        if (err.status === 400) console.error(err.data);
        return null;
    }
}

(async () => {
    token = await getToken();
    if (!token) return;
    client.defaults.headers.common['X-Auth-Token'] = token;
    // check if camera exists else create one
    const camera = await fetchPseudoCamera(cameraUuid);
    // create job
    // console.log(assetPath);
    const assets = await glob(`${assetPath}/**/*.+(MP4|mp4|MOV|mov)`);
    // const assets = await glob(`${process.cwd()}/assets/**/*.+(jpeg|jpg)`);
    console.log(assets);
    for (const asset of assets) {
        const footageId = await submitJob(camera.cameraId, asset);
        console.log(`Footage ID:  ${footageId}`)
        if (!footageId) return;
        const footage = await fetchFootage(footageId);
        if (!footage) return;
        // const faceMatches = await fetchFaceMatches(footageId, 'Enrollment', formatDate(new Date(footage.startTime)), formatDate(new Date(footage.endTime)));
        // console.log(faceMatches);
        // if (faceMatches.content && faceMatches.content.length > 0) {
        //     for (const faceObj of faceMatches.content) {
        //         console.log(faceObj.faceTarget.name);
        //         console.log(faceObj.faceTarget.faceTargetId);
        //         console.log(faceObj.faceTarget.category.name);
        //         console.log(faceObj.similarity);
        //     }
        // }
        const lprOutput = await fetchPlates(footageId, formatDate(new Date(footage.startTime)), formatDate(new Date(footage.endTime)));
        console.log(lprOutput)
    }
    if (cameraDelete)
        await removePseudoCamera(camera.cameraId);
})();