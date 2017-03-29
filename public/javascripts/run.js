angular.module('ZooPhy').controller('runController', function ($scope, $http, RecordData) {

  const EMAIL_RE = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

  $scope.numSelected = RecordData.getNumSelected();
  $scope.jobEmail = null;
  $scope.jobName = null;
  $scope.runError = null;
  $scope.running = false;
  $scope.success = false;

  $scope.$watch(function () {return RecordData.getNumSelected();}, function (newValue, oldValue) {
    if (newValue !== oldValue) {
      $scope.numSelected = newValue;
    }
  });

  $scope.runJob = function() {
    console.log('starting job...');
    $scope.runError = null;
    $scope.running = true;
    if ($scope.jobEmail && EMAIL_RE.test($scope.jobEmail)) {
      let jobAccessions = [];
      let records = RecordData.getRecords();
      for (let i = 0; i < records.length; i++) {
        if (records[i].includeInJob) {
          jobAccessions.push(records[i].accession);
        }
      }
      if (jobAccessions.length < 5) {
        $scope.runError = 'Too Few Records, Minimun is 5';
        $scope.running = false;
      }
      else if (jobAccessions.length > 1000) {
        $scope.runError = 'Too Many Records, Maximum is 1000';
        $scope.running = false;
      }
      else {
        let runUri = SERVER_URI+'/job/run';
        let jobData = {
          replyEmail: $scope.jobEmail,
          jobName: $scope.jobName,
          accessions: jobAccessions,
          useGLM: false,
          predictors: null
        };
        console.log(jobData);
        $http.post(runUri, jobData).then(function success(response) {
          $scope.running = false;
          if (response.status === 202) {
            $scope.success = true; //TODO give job ID
          }
          else {
            $scope.runError = 'Job Validation Failed';
            console.log(response.status);
          }
        }, function failure(response) {
          $scope.runError = 'Job Validation Failed';
          console.log(response.statusText);
        });
      }
    }
    else {
      $scope.runError = 'Invalid Email';
      $scope.running = false;
    }
  };

});

/*
Copyright 2017 ASU Biodesign Center for Environmental Security's ZooPhy Lab

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/