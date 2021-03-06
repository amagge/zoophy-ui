'use strict';

let app = require('../app');
let express = require('express');
let checkInput = require('../bin/validator_tool').checkInput;
let logger = require('../bin/logger_tool');
let request = require('request');
let fs = require('fs');
let uuid = require('uuid/v4');
let path = require('path');
let multer = require('multer');
const multerOptions = {
  dest: 'uploads/',
  limits: {
    fileSize: 50000 //50KB
  }
};
let upload = multer(multerOptions);
let GLMPredictor = require('../bin/glm_predictor');

const API_URI = require('../bin/settings').API_CONFIG.ZOOPHY_URI;

const DOWNLOAD_FOLDER = path.join(__dirname, '../public/downloads/');
const ACCESSION_RE = /^([A-Z]|\d|_|\.){5,10}?$/;
const EMAIL_RE = /^[^@\s]+?@[^@\s]+?\.[^@\s]+?$/;
const JOB_NAME_RE = /^(\w| |-|_|#|&){3,255}?$/;
const BASE_ERROR = 'INVALID JOB PARAMETER(S): ';
const PREDICTOR_FILE_RE = /^(\w|-|\.){1,250}?\.tsv$/;
const STATE_RE = /^(\w|-|\.|,| |'){1,255}?$/;
const PREDICTOR_RE = /^(\w|-|\.| ){1,255}?$/;
const MODEL_RE = /^(HKY)$/;

let router = express.Router();

router.post('/run', function(req, res) {
  let result;
  try {
    let jobErrors = BASE_ERROR;
    let accessions;
    if (!req.body.accessions) {
      jobErrors += 'Missing Accessions, ';
    }
    else if (req.body.accessions.length < 5 || req.body.accessions.length > 1000) {
      jobErrors += 'Invalid number of Accessions: '+req.body.accessions.length+', ';
    }
    else {
      accessions = [];
      for (let i = 0; i < req.body.accessions.length; i++) {
        if (checkInput(req.body.accessions[i], 'string', ACCESSION_RE)) {
          accessions.push(String(req.body.accessions[i]));
        }
        else {
          jobErrors += 'Invalid Accession: '+req.body.accessions[i]+', ';
          break;
        }
      }
    }
    let email = null;
    if (!req.body.replyEmail) {
      jobErrors += 'Missing Reply Email, ';
    }
    else if (checkInput(req.body.replyEmail, 'string', EMAIL_RE)) {
      email = String(req.body.replyEmail);
    }
    else {
      jobErrors += 'Invalid Email: '+req.body.replyEmail+', ';
    }
    let jobName = null;
    if (req.body.jobName) {
      if (checkInput(req.body.jobName, 'string', JOB_NAME_RE)) {
        jobName = String(req.body.jobName);
      }
      else {
        jobErrors += 'Invalid Job Name: '+req.body.jobName+', ';
      }
    }
    let useGLM = Boolean(req.body.useGLM === true);
    let predictors = null;
    if (useGLM && req.body.predictors !== undefined && req.body.predictors !== null) {
      logger.info('Job is using Custom Predictors');
      let predictorsAreValid = true;
      for (let state in req.body.predictors) {
        if (req.body.predictors.hasOwnProperty(state)) {
          if (!validatePredictor(state, req.body.predictors[state])) {
            predictorsAreValid = false;
          }
        }
      }
      if (predictorsAreValid) {
        predictors = req.body.predictors;
      }
      else {
        jobErrors += 'Invalid Custom Job Predictors, ';
      }
    }
    let xmlOptions = null;
    if (checkInput(req.body.xmlOptions.chainLength, 'number', null) && checkInput(req.body.xmlOptions.subSampleRate, 'number', null) && checkInput(req.body.xmlOptions.substitutionModel, 'string', MODEL_RE)) {
      xmlOptions = {
        chainLength: Number(req.body.xmlOptions.chainLength),
        subSampleRate: Number(req.body.xmlOptions.subSampleRate),
        substitutionModel: String(req.body.xmlOptions.substitutionModel)
      };
    }
    else {
       jobErrors += 'Invalid XML Parameters, ';
    }
    if (jobErrors === BASE_ERROR) {
      const zoophyJob = JSON.stringify({
        accessions: accessions,
        replyEmail: email,
        jobName: jobName,
        useGLM: useGLM,
        predictors: predictors,
        xmlOptions: xmlOptions
      });
      logger.info('Parameters valid, testing ZooPhy Job with '+accessions.length+' accessions:\n'+zoophyJob);
      request.post({
        url: API_URI+'/validate',
        headers: {
          'Content-Type': 'application/json',
        },
        body: zoophyJob
      }, function(error, response, body) {
        if (error) {
          logger.error(error);
          result = {
            status: 500,
            error: String(error)
          };
          res.status(result.status).send(result);
        }
        else {
          let validationResults = JSON.parse(body);
          if (response.statusCode === 200 && validationResults.error === null) {
            logger.warn('Accessions removed in job validation: '+validationResults.accessionsRemoved);
            logger.info('Starting ZooPhy Job for: '+email+' with '+validationResults.accessionsUsed.length+' records.');
            request.post({
              url: API_URI+'/run',
              headers: {
                'Content-Type': 'application/json',
              },
              body: zoophyJob
            }, function(error, response, body) {
              if (error) {
                logger.error(error);
                result = {
                  status: 500,
                  error: 'Unknown ZooPhy API Error during Start'
                };
                res.status(result.status).send(result);
              }
              else {
                logger.info('Job Started: ', response.statusCode, body);
                if (response.statusCode === 202) {
                  result = {
                    status: 202,
                    message: String(body),
                    jobSize: validationResults.accessionsUsed.length,
                    recordsRemoved: validationResults.accessionsRemoved
                  };
                  logger.info(result)
                }
                else {
                  result = {
                    status: 500,
                    error: 'Unknown ZooPhy API Error during Start'
                  };
                }
                res.status(result.status).send(result);
              }
            });
          }
          else if (validationResults.error) {
            logger.warn(validationResults.error);
            result = {
              status: 200,
              error: String(validationResults.error)
            };
            res.status(result.status).send(result);
          }
          else {
            logger.warn('Unknown ZooPhy API Error');
            result = {
              status: 200,
              error: 'Unknown ZooPhy API Error during Validation'
            };
            res.status(result.status).send(result);
          }
        }
      });
    }
    else {
      if (jobErrors.endsWith(', ')) {
        jobErrors = jobErrors.substring(0,jobErrors.length-2);
      }
      logger.warn(jobErrors);
      result = {
        status: 400,
        error: jobErrors
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Failed to start ZooPhy Job: '+err);
    result = {
      status: 500,
      error: 'Failed to start ZooPhy Job'
    };
    res.status(result.status).send(result);
  }
});

router.post('/predictors/template', function(req, res) {
  let result;
  try {
    if (req.body.accessions) {
      let accessions = [];
      let invalidAcc = -1;
      for (let i = 0; i < req.body.accessions.length; i++) {
        if (checkInput(req.body.accessions[i], 'string', ACCESSION_RE)) {
          accessions.push(String(req.body.accessions[i]));
        }
        else {
          logger.warn('Bad Accession Requested: '+String(req.body.accessions[i]))
          invalidAcc = i;
          break;
        }
      }
      if (invalidAcc !== -1) {
        result = {
          status: 400,
          error: 'Invalid Accession: '+String(req.body.accessions[invalidAcc])
        };
        res.status(result.status).send(result);
      }
      else {
        logger.info('Retrieving Predictors Download for '+accessions.length+' records...');
        request.post({
          url: API_URI+'/template',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(accessions)
        }, function(error, response, body) {
          if (error) {
            logger.error(error);
            result = {
              status: 500,
              error: String(error)
            };
            res.status(result.status).send(result);
          }
          else if (response.statusCode === 200) {
            let fileName = String(uuid())+'.tsv';
            let filePath = DOWNLOAD_FOLDER+fileName;
            logger.info('Download received. Writing file: '+filePath);
            let fileContents = String(body);
            fs.writeFile(filePath, fileContents, function(err) {
              if (err) {
                logger.error('Error writing download: '+err);
                result = {
                  status: 500,
                  error: 'Error writing download'
                };
              }
              else {
                result = {
                  status: 200,
                  downloadPath: '/downloads/'+fileName
                };
              }
              res.status(result.status).send(result);
            });
          }
          else {
            logger.error('Download request failed: '+response.statusCode);
            result = {
              status: 500,
              error: 'ZooPhy API Download Request Failed'
            };
            res.status(result.status).send(result);
          }
        });
      }
    }
    else {
      result = {
        status: 400,
        error: 'Missing Accessions'
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Failed to load Predictor Template: '+err);
    result = {
      status: 500,
      error: 'Failed to load Predictor Template'
    };
    res.status(result.status).send(result);
  }
});

router.post('/predictors', upload.single('predictorsBatchFile'), function (req, res) {
  let result;
  try {
    logger.info('Setting Predictors...');
    if (req.file) {
      logger.info('Processing Predictor file upload...');
      let predictorFile = req.file;
      if (predictorFile.mimetype === 'text/tab-separated-values' && (checkInput(predictorFile.originalname, 'string', PREDICTOR_FILE_RE))) {
        fs.readFile(predictorFile.path, function (err, data) {
          if (err) {
            logger.error(error);
            result = {
              status: 500,
              error: String(error)
            };
            res.status(result.status).send(result);
          }
          else {
            let rawPredictorLines = data.toString().trim().split('\n');
            logger.info('Deleting valid file...');
            fs.unlink(predictorFile.path, function (err) {
              if (err) {
                logger.warn('Failed to delete valid file: '+predictorFile.path);
              }
              else {
                logger.info('Successfully deleted valid file.');
              }
            });
            let predictors = {};
            const predictorNames = rawPredictorLines[0].trim().split("\t");
            let invalidName = -1;
            for (let i = 0; i < predictorNames.length; i++) {
              if (!(checkInput(predictorNames[i], 'string', PREDICTOR_RE))) {
                invalidName = i;
                break;
              }
            }
            if (invalidName !== -1) {
              result = {
                status: 400,
                error: 'Invalid Predictor name: "'+predictorNames[invalidName]+'"'
              };
              res.status(result.status).send(result);
            }
            else {
              let stateError = null;
              for (let i = 1; i < rawPredictorLines.length && stateError == null; i++) {
                let stateLine = rawPredictorLines[i].trim().split("\t");
                const state = String(stateLine[0].trim());
                if (!(checkInput(state, 'string', STATE_RE))) {
                  stateError = state;
                  break;
                }
                let statePredictors = [];
                for (let j = 1; j < stateLine.length && stateError == null; j++) {
                  if (checkInput(stateLine[j],'number', null)) {
                    let predictor = new GLMPredictor(state, predictorNames[j], stateLine[j]);
                    statePredictors.push(predictor);
                  }
                  else {
                    stateError = stateLine[j];
                    break;
                  }
                }
                predictors[state] = statePredictors;
              }
              if (stateError === null) {
                result = {
                  status: 200,
                  predictors: predictors
                };
              }
              else {
                result = {
                  status: 400,
                  error: 'Invalid Predictor value: "'+stateError+'"'
                };
              }
              res.status(result.status).send(result);
            }
          }
        });
      }
      else {
        logger.warn('Deleting Invalid Predictor file...');
        fs.unlink(predictorFile.path, function (err) {
          if (err) {
            logger.error('Failed to delete invalid file: '+predictorFile.path);
          }
          else {
            logger.info('Successfully deleted invalid file.');
          }
        });
        result = {
          status: 400,
          error: 'Invalid Predictor File'
        };
        res.status(result.status).send(result);
      }
    }
    else {
      logger.warn('Missing Predictor File');
      result = {
        status: 400,
        error: 'Missing Predictor File'
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Failed to set Predictors: '+err);
    result = {
      status: 500,
      error: 'Failed to set Predictors'
    };
    res.status(result.status).send(result);
  }
});

function validatePredictor(state, predictors) {
  try {
    if ((predictors instanceof Array) && checkInput(state, 'string', STATE_RE)) {
      for (let i = 0; i < predictors.length; i++) {
        let predictor = predictors[i];
        if (!(typeof predictor === 'object' && Object.keys(predictor).length === 4 && predictor.state === state && checkInput(predictor.name, 'string', PREDICTOR_RE) && checkInput(predictor.value, 'number', null) && predictor.year === null)) {
          return false;
        }
      }
      return true;
    }
    else {
      return false;
    }
  }
  catch (err) {
    return false;
  }
};

module.exports = router;
