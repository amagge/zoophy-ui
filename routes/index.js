'use strict';

let app = require('../app');
let express = require('express');
let checkInput = require('../bin/validator_tool').checkInput;
let logger = require('../bin/logger_tool');
let request = require('request');
let GenBankRecord = require('../bin/genbank_record');
let fs = require('fs');
let uuid = require('uuid/v4');
let path = require('path');
let multer = require('multer');
const multerOptions = {
  dest: 'uploads/',
  limits: {
    fileSize: 50000 //5KB
  }
};
let upload = multer(multerOptions);

const ALLOWED_VALUES = require('../bin/allowed_values');
const API_URI = require('../bin/settings').API_CONFIG.ZOOPHY_URI;
const DOWNLOAD_FOLDER = path.join(__dirname, '../public/downloads/');

const QUERY_RE = /^(\w| |:|\[|\]|\(|\)){5,5000}?$/;
const ACCESSION_RE = /^([A-Z]|\d){5,10}?$/;
const DOWNLOAD_FORMAT_RE = /^(csv)|(fasta)$/;
const ACCESSION_UPLOAD_RE = /^(\w|-|\.){1,250}?\.txt$/;
const ACCESSION_VERSION_RE = /^([A-Z]|\d|_|\.){5,10}?\.\d{1,2}?$/;
const UPLOAD_QUERY_LIMIT = 2500;

let router = express.Router();

router.get('/', function(req, res) {
  res.status(200).render('home', {allowed_values: ALLOWED_VALUES});
});

router.get('/allowed', function(req, res) {
  res.status(200).send(ALLOWED_VALUES);
});

router.get('/search', function(req, res) {
  let result;
  try {
    if (checkInput(req.query.query, 'string', QUERY_RE)) {
      let query = String(req.query.query.trim());
      logger.info('sending query: '+query);
      query = encodeURIComponent(query.trim());
      let uri = API_URI+'/search?query='+query;
      request.get(uri, function (error, response, body) {
        if (error) {
          logger.error('Search failed to call ZooPhy API'+error);
          result = {
            status: 500,
            error: 'Failed to call ZooPhy API'
          };
        }
        else if (response && response.statusCode === 200) {
          let rawRecords = JSON.parse(body);
          let records = [];
          for (let i = 0; i < rawRecords.length; i++) {
            let record = new GenBankRecord.LuceneRecord(rawRecords[i]);
            records.push(record);
          }
          result = {
            status: 200,
            records: records
          };
        }
        else {
          let err = '';
          if (response) {
            err = body;
          }
          logger.error('Search failed to retrieve records from ZooPhy API'+err);
          result = {
            status: 500,
            error: 'Failed to retrieve records from ZooPhy API'
          };
        }
        res.status(result.status).send(result);
      });
    }
    else {
      logger.warn('Bad Search query'+String(req.query.query));
      result = {
        status: 400,
        error: 'Invalid Lucene Query'
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Search failed to retrieve records from ZooPhy API'+err);
    result = {
      status: 500,
      error: 'Failed to retrieve records from ZooPhy API'
    };
    res.status(result.status).send(result);
  }
});

router.get('/record', function(req, res) {
  let result;
  try {
    if (checkInput(req.query.accession, 'string', ACCESSION_RE)) {
      let accession = String(req.query.accession.trim());
      logger.info('Retrieving Accession: '+accession);
      let uri = API_URI+'/record?accession='+accession;
      request.get(uri, function (error, response, body) {
        if (error) {
          logger.error('Failed to get record from ZooPhy API'+error);
          result = {
            status: 500,
            error: 'Failed to call ZooPhy API'
          };
        }
        else if (response && response.statusCode === 200) {
          let rawRecord = JSON.parse(body);
          let record = new GenBankRecord.SQLRecord(rawRecord);
          result = {
            status: 200,
            record: record
          };
        }
        else if (response && response.statusCode === 404) {
          logger.warn('Record '+accession+' does not exist in DB.');
          result = {
            status: 404,
            error: 'Record '+accession+' does not exist in DB.'
          };
        }
        else {
          let err = '';
          if (response) {
            err = body;
          }
          logger.error('Failed to get record from ZooPhy API'+err);
          result = {
            status: 500,
            error: 'Failed to retrieve record from ZooPhy API'
          };
        }
        res.status(result.status).send(result);
      });
    }
    else {
      logger.warn('Bad Accession: '+String(req.query.accession));
      result = {
        status: 400,
        error: 'Invalid Accession'
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Search failed to retrieve records from ZooPhy API'+err);
    result = {
      status: 500,
      error: 'Failed to retrieve records from ZooPhy API'
    };
    res.status(result.status).send(result);
  }
});

router.post('/download/:format', function(req, res) {
  let result;
  try {
    if (checkInput(req.params.format, 'string', DOWNLOAD_FORMAT_RE)) {
      let format = String(req.params.format);
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
          logger.info('Retrieving '+format+' Download for '+accessions.length+' records...');
          request.post({
            url: API_URI+'/download?format='+format,
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
              let fileName = String(uuid())+'.'+format;
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
    else {
      logger.warn('Bad Download format: '+String(req.params.format));
      result = {
        status: 400,
        error: 'Invalid Format'
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Failed to retrieve Download from ZooPhy API'+err);
    result = {
      status: 500,
      error: 'Failed to retrieve Download from ZooPhy API'
    };
    res.status(result.status).send(result);
  }
});

router.post('/upload', upload.single('accessionFile'), function (req, res) {
  let result;
  try {
    if (req.file) {
      logger.info('Processing Accession file upload...');
      let accessionFile = req.file;
      if (accessionFile.mimetype === 'text/plain' && checkInput(accessionFile.originalname, 'string', ACCESSION_UPLOAD_RE)) {
        fs.readFile(accessionFile.path, function (err, data) {
          if (err) {
            logger.error(error);
            result = {
              status: 500,
              error: String(error)
            };
            res.status(result.status).send(result);
          }
          else {
            let rawAccessions = data.toString().trim().split('\n');
            fs.unlink(accessionFile.path, function (err) {
              if (err) {
                logger.warn('Failed to delete valid file: '+accessionFile.path);
              }
              else {
                logger.info('Successfully deleted valid file.');
              }
            });
            let cleanAccessions = [];
            let fileErrors = [];
            for (let i = 0; i < rawAccessions.length && i < UPLOAD_QUERY_LIMIT; i++) {
              if (checkInput(rawAccessions[i], 'string', ACCESSION_RE)) {
                cleanAccessions.push(String(rawAccessions[i]));
              }
              else if (checkInput(rawAccessions[i], 'string', ACCESSION_VERSION_RE)) {
                cleanAccessions.push(String(rawAccessions[i].substr(0,rawAccessions[i].indexOf('.'))));
              }
              else {
                fileErrors.push(String('"'+rawAccessions[i]+'" on line #'+String(i+1)));
              }
            }
            if (fileErrors.length > 0) {
              let humanizedErrors = 'Invalid Accesion(s): '+fileErrors[0];
              for (let i = 1; i < fileErrors.length; i++) {
                humanizedErrors += ', '+fileErrors[i];
              }
              logger.warn(humanizedErrors.trim());
              result = {
                status: 400,
                error: humanizedErrors.trim()
              };
              res.status(result.status).send(result);
            }
            else {
              request.post({
                url: API_URI+'/search/accessions',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(cleanAccessions)
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
                  let rawRecords = JSON.parse(body);
                  let records = [];
                  for (let i = 0; i < rawRecords.length; i++) {
                    let record = new GenBankRecord.LuceneRecord(rawRecords[i]);
                    records.push(record);
                  }
                  result = {
                    status: 200,
                    records: records
                  };
                  res.status(result.status).send(result);
                }
              });   
            }
          }
        });
      }
      else {
        logger.warn('Invalid file received. Deleting...');
        fs.unlink(accessionFile.path, function (err) {
          if (err) {
            logger.error('Failed to delete invalid file: '+accessionFile.path);
          }
          else {
            logger.info('Successfully deleted invalid file.');
          }
        });
        result = {
          status: 400,
          error: 'Invalid File'
        };
        res.status(result.status).send(result);
      }
    }
    else {
      logger.error('Missing Accession File');
      result = {
        status: 400,
        error: 'Missing Accession File'
      };
      res.status(result.status).send(result);
    }
  }
  catch (err) {
    logger.error('Failed to proccess Accession upload '+err);
    result = {
      status: 500,
      error: 'Failed to proccess Accession upload'
    };
    res.status(result.status).send(result);
  }
});

module.exports = router;
