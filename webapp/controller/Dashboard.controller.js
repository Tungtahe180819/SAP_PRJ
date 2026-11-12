sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/ViewSettingsDialog",
    "sap/m/ViewSettingsItem",
    "sap/ui/layout/form/SimpleForm",
    "sap/viz/ui5/controls/VizFrame",
    "sap/viz/ui5/data/FlattenedDataset",
    "sap/viz/ui5/controls/common/feeds/FeedItem",
  ],
  function (
    Controller,
    JSONModel,
    MessageBox,
    Dialog,
    Button,
    Label,
    Text,
    ViewSettingsDialog,
    ViewSettingsItem,
    SimpleForm,
    VizFrame,
    FlattenedDataset,
    FeedItem,
  ) {
    "use strict";

    return Controller.extend("com.example.hranalytics.controller.Dashboard", {
      onInit: function () {
        this._bExited = false;
        this._oEmployeeDialog = null;
        this._oSortDialog = null;

        var oModel = new JSONModel({
          busy: false,
          employees: [],
          analysisEmployees: [],
          filteredEmployees: [],
          filteredCount: 0,
          totalEmployees: 0,
          totalDepartments: 0,
          averageAge: "—",
          summary: "",
          searchQuery: "",
          sortKey: "EmpId",
          sortDescending: false,
          draft: {
            department: "",
            jobTitle: "",
            gender: "",
          },
          applied: {
            department: "",
            jobTitle: "",
            gender: "",
          },
          departments: [
            {
              DeptId: "",
              DeptName: "All Departments",
            },
          ],
          jobTitles: [
            {
              Key: "",
              JobTitle: "All Job Titles",
            },
          ],
          genders: [
            { Key: "", GenderName: "All Genders" },
            { Key: "M", GenderName: "Male" },
            { Key: "F", GenderName: "Female" },
            { Key: "O", GenderName: "Other" },
            { Key: "U", GenderName: "Unknown" },
          ],
          chartKey: "Department",
          chartOptions: [
            { Key: "Department", ChartName: "Department" },
            { Key: "Gender", ChartName: "Gender" },
            { Key: "Age", ChartName: "Age Group" },
            { Key: "Job", ChartName: "Job Title" },
            { Key: "Hire", ChartName: "Hire Year" },
          ],
          chartRows: [],
          selectedEmployee: {},
        });

        oModel.setSizeLimit(10000);
        this.getView().setModel(oModel, "dashboard");
        this._loadData();
      },

      onExit: function () {
        this._bExited = true;

        if (this._oEmployeeDialog) {
          this._oEmployeeDialog.destroy();
        }

        if (this._oSortDialog) {
          this._oSortDialog.destroy();
        }

        var oModel = this.getView().getModel("dashboard");

        if (oModel) {
          oModel.destroy();
        }
      },

      onRefreshButtonPress: function () {
        this._loadData();
      },

      _loadData: function () {
        var oModel = this.getView().getModel("dashboard");
        var oODataModel = this.getOwnerComponent().getModel();

        if (oModel.getProperty("/busy")) {
          return;
        }

        if (!oODataModel) {
          MessageBox.error("The OData model is unavailable.");
          return;
        }

        oModel.setProperty("/busy", true);

        var aEmployees = [];
        var aDepartments = [];
        var iCompleted = 0;
        var bFailed = false;

        var fnComplete = function () {
          if (this._bExited || bFailed) {
            return;
          }

          iCompleted += 1;

          if (iCompleted !== 2) {
            return;
          }

          try {
            this._prepareData(aEmployees, aDepartments);
          } catch (oError) {
            MessageBox.error(this._getErrorMessage(oError));
          } finally {
            oModel.setProperty("/busy", false);
          }
        }.bind(this);

        var fnError = function (oError) {
          if (this._bExited || bFailed) {
            return;
          }

          bFailed = true;
          oModel.setProperty("/busy", false);

          MessageBox.error(
            "Cannot load HR data.\n" + this._getErrorMessage(oError),
          );
        }.bind(this);

        this._readAll(
          oODataModel,
          "/EmployeeSet",
          function (aRows) {
            aEmployees = aRows;
            fnComplete();
          },
          fnError,
        );

        this._readAll(
          oODataModel,
          "/DepartmentSet",
          function (aRows) {
            aDepartments = aRows;
            fnComplete();
          },
          fnError,
        );
      },

      _readAll: function (oODataModel, sInitialPath, fnSuccess, fnError) {
        var aResults = [];
        var mVisited = Object.create(null);

        var fnRead = function (sPath) {
          if (this._bExited) {
            return;
          }

          if (mVisited[sPath]) {
            fnError(new Error("Repeated data page."));
            return;
          }

          mVisited[sPath] = true;

          oODataModel.read(sPath, {
            success: function (oData) {
              if (this._bExited) {
                return;
              }

              aResults = aResults.concat(oData.results || []);

              if (!oData.__next) {
                fnSuccess(aResults);
                return;
              }

              var sNextPath;

              try {
                sNextPath = this._getNextPath(oData.__next, sPath);
              } catch (oError) {
                fnError(oError);
                return;
              }

              fnRead(sNextPath);
            }.bind(this),
            error: fnError,
          });
        }.bind(this);

        fnRead(sInitialPath);
      },

      _getNextPath: function (sNextUrl, sCurrentPath) {
        var sService = "/sap/opu/odata/sap/Z325_HR_ANALYTICS_SRV/";

        var sUrl = String(sNextUrl || "").split("#")[0];
        var iIndex = sUrl.indexOf(sService);

        if (iIndex !== -1) {
          sUrl = sUrl.substring(iIndex + sService.length);
        }

        if (/^\/?(EmployeeSet|DepartmentSet)(\?|$)/.test(sUrl)) {
          return "/" + sUrl.replace(/^\//, "");
        }

        if (sUrl.charAt(0) === "?") {
          return sCurrentPath.split("?")[0] + sUrl;
        }

        throw new Error("Unexpected pagination URL.");
      },

      _prepareData: function (aRawEmployees, aRawDepartments) {
        var oModel = this.getView().getModel("dashboard");
        var mDepartments = Object.create(null);
        var mJobs = Object.create(null);

        var aDepartments = aRawDepartments.map(function (oDepartment) {
          var sDepartmentId = String(oDepartment.DeptId || "").trim();

          var sDepartmentName = String(
            oDepartment.DeptName || sDepartmentId,
          ).trim();

          mDepartments[sDepartmentId] = sDepartmentName;

          return {
            DeptId: sDepartmentId,
            DeptName: sDepartmentName,
          };
        });

        aDepartments.sort(function (a, b) {
          return a.DeptName.localeCompare(b.DeptName);
        });

        var aEmployees = aRawEmployees.map(function (oRow) {
          var sDepartmentId = String(oRow.DeptId || "").trim();
          var sJobTitle = String(oRow.JobTitle || "").trim();
          var sGender = String(oRow.Gender || "")
            .trim()
            .toUpperCase();

          var sGenderText = "Unknown";

          if (sGender === "M") {
            sGenderText = "Male";
          } else if (sGender === "F") {
            sGenderText = "Female";
          } else if (sGender === "O") {
            sGenderText = "Other";
          } else {
            sGender = "U";
          }

          if (sJobTitle) {
            mJobs[sJobTitle] = true;
          }

          return {
            EmpId: String(oRow.EmpId || ""),
            EmpName: String(oRow.EmpName || ""),
            DeptId: sDepartmentId,
            DeptName: mDepartments[sDepartmentId] || sDepartmentId || "Unknown",
            Gender: sGender,
            GenderText: sGenderText,
            JobTitle: sJobTitle,
            BirthDate: oRow.BirthDate,
            HireDate: oRow.HireDate,
          };
        });

        oModel.setProperty("/employees", aEmployees);

        oModel.setProperty(
          "/departments",
          [
            {
              DeptId: "",
              DeptName: "All Departments",
            },
          ].concat(aDepartments),
        );

        oModel.setProperty(
          "/jobTitles",
          [
            {
              Key: "",
              JobTitle: "All Job Titles",
            },
          ].concat(
            Object.keys(mJobs)
              .sort()
              .map(function (sName) {
                return {
                  Key: sName,
                  JobTitle: sName,
                };
              }),
          ),
        );

        this._applyAnalysisFilters();
      },

      onGoButtonPress: function () {
        var oModel = this.getView().getModel("dashboard");
        var oDraft = oModel.getProperty("/draft");

        oModel.setProperty("/applied", {
          department: oDraft.department,
          jobTitle: oDraft.jobTitle,
          gender: oDraft.gender,
        });

        this._applyAnalysisFilters();
      },

      onClearButtonPress: function () {
        var oModel = this.getView().getModel("dashboard");

        oModel.setProperty("/draft", {
          department: "",
          jobTitle: "",
          gender: "",
        });

        oModel.setProperty("/applied", {
          department: "",
          jobTitle: "",
          gender: "",
        });

        oModel.setProperty("/searchQuery", "");
        this._applyAnalysisFilters();
      },

      _applyAnalysisFilters: function () {
        var oModel = this.getView().getModel("dashboard");
        var oApplied = oModel.getProperty("/applied");
        var aEmployees = oModel.getProperty("/employees") || [];

        var aFiltered = aEmployees.filter(function (oEmployee) {
          return (
            (!oApplied.department ||
              oEmployee.DeptId === oApplied.department) &&
            (!oApplied.jobTitle || oEmployee.JobTitle === oApplied.jobTitle) &&
            (!oApplied.gender || oEmployee.Gender === oApplied.gender)
          );
        });

        var mDepartments = Object.create(null);
        var iAgeTotal = 0;
        var iValidAges = 0;

        aFiltered.forEach(
          function (oEmployee) {
            if (oEmployee.DeptId) {
              mDepartments[oEmployee.DeptId] = true;
            }

            var iAge = this._getAge(oEmployee.BirthDate);

            if (iAge !== null) {
              iAgeTotal += iAge;
              iValidAges += 1;
            }
          }.bind(this),
        );

        var iDepartmentCount = Object.keys(mDepartments).length;

        oModel.setProperty("/analysisEmployees", aFiltered);
        oModel.setProperty("/totalEmployees", aFiltered.length);
        oModel.setProperty("/totalDepartments", iDepartmentCount);
        oModel.setProperty(
          "/averageAge",
          iValidAges ? (iAgeTotal / iValidAges).toFixed(1) : "—",
        );

        oModel.setProperty(
          "/summary",
          aFiltered.length +
            " employees · " +
            iDepartmentCount +
            " departments",
        );

        this._applyTableSearchAndSort();
        this._renderChart();
      },

      onSearchQuerySearchFieldLiveChange: function (oEvent) {
        this.getView()
          .getModel("dashboard")
          .setProperty("/searchQuery", oEvent.getParameter("newValue") || "");

        this._applyTableSearchAndSort();
      },

      _applyTableSearchAndSort: function () {
        var oModel = this.getView().getModel("dashboard");

        var sQuery = String(oModel.getProperty("/searchQuery") || "")
          .trim()
          .toLowerCase();

        var sSortKey = oModel.getProperty("/sortKey");
        var bDescending = oModel.getProperty("/sortDescending");

        var aRows = (oModel.getProperty("/analysisEmployees") || []).filter(
          function (oEmployee) {
            var sText = [
              oEmployee.EmpId,
              oEmployee.EmpName,
              oEmployee.DeptName,
              oEmployee.JobTitle,
            ]
              .join(" ")
              .toLowerCase();

            return sText.indexOf(sQuery) !== -1;
          },
        );

        aRows.sort(function (a, b) {
          var iResult = String(a[sSortKey] || "").localeCompare(
            String(b[sSortKey] || ""),
          );

          return bDescending ? -iResult : iResult;
        });

        oModel.setProperty("/filteredEmployees", aRows);
        oModel.setProperty("/filteredCount", aRows.length);
      },

      onSortButtonPress: function () {
        if (!this._oSortDialog) {
          var aSortItems = [
            ["EmpId", "Employee ID"],
            ["EmpName", "Full Name"],
            ["DeptName", "Department"],
            ["JobTitle", "Job Title"],
          ].map(
            function (aField) {
              return new ViewSettingsItem(
                this.getView().createId("id" + aField[0] + "SortItem"),
                {
                  key: aField[0],
                  text: aField[1],
                  selected: aField[0] === "EmpId",
                },
              );
            }.bind(this),
          );

          this._oSortDialog = new ViewSettingsDialog(
            this.getView().createId("idSortViewSettingsDialog"),
            {
              sortItems: aSortItems,
              confirm: function (oEvent) {
                var oSortItem = oEvent.getParameter("sortItem");

                var oModel = this.getView().getModel("dashboard");

                oModel.setProperty(
                  "/sortKey",
                  oSortItem ? oSortItem.getKey() : "EmpId",
                );

                oModel.setProperty(
                  "/sortDescending",
                  oEvent.getParameter("sortDescending"),
                );

                this._applyTableSearchAndSort();
              }.bind(this),
            },
          );

          this.getView().addDependent(this._oSortDialog);
        }

        this._oSortDialog.open();
      },

      onChartOptionsSelectChange: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");

        if (oItem) {
          this.getView()
            .getModel("dashboard")
            .setProperty("/chartKey", oItem.getKey());
        }

        this._renderChart();
      },

      _renderChart: function () {
        var oModel = this.getView().getModel("dashboard");
        var sKey = oModel.getProperty("/chartKey");
        var aEmployees = oModel.getProperty("/analysisEmployees") || [];

        var mDefinitions = {
          Department: {
            type: "bar",
            dimension: "Department",
          },
          Gender: {
            type: "donut",
            dimension: "Gender",
          },
          Age: {
            type: "column",
            dimension: "Age Group",
          },
          Job: {
            type: "bar",
            dimension: "Job Title",
          },
          Hire: {
            type: "column",
            dimension: "Year",
          },
        };

        var oDefinition = mDefinitions[sKey];
        var oContainer = this.byId("idChartContainerVBox");

        // Destroy old chart before reusing its stable ID.
        oContainer.destroyItems();

        oModel.setProperty(
          "/chartRows",
          this._buildChartRows(aEmployees, sKey),
        );

        var oDataset = new FlattenedDataset(
          this.getView().createId("idAnalysisDataset"),
          {
            dimensions: [
              {
                name: oDefinition.dimension,
                value: "{dashboard>Label}",
              },
            ],
            measures: [
              {
                name: "Employees",
                value: "{dashboard>Count}",
              },
            ],
            data: {
              path: "dashboard>/chartRows",
            },
          },
        );

        var bDonut = oDefinition.type === "donut";

        var oChart = new VizFrame(
          this.getView().createId("idAnalysisVizFrame"),
          {
            width: "100%",
            height: "360px",
            vizType: oDefinition.type,
            uiConfig: {
              applicationSet: "fiori",
            },
            dataset: oDataset,
          },
        );

        oChart.addFeed(
          new FeedItem(this.getView().createId("idAnalysisMeasureFeedItem"), {
            uid: bDonut ? "size" : "valueAxis",
            type: "Measure",
            values: ["Employees"],
          }),
        );

        oChart.addFeed(
          new FeedItem(this.getView().createId("idAnalysisDimensionFeedItem"), {
            uid: bDonut ? "color" : "categoryAxis",
            type: "Dimension",
            values: [oDefinition.dimension],
          }),
        );

        oChart.setVizProperties({
          title: {
            visible: false,
          },
          legend: {
            visible: bDonut,
          },
          plotArea: {
            dataLabel: {
              visible: true,
            },
          },
        });

        oContainer.addItem(oChart);
      },

      _buildChartRows: function (aEmployees, sKey) {
        if (!aEmployees.length) {
          return [];
        }

        var mCounts = Object.create(null);

        var aAgeGroups = [
          { Label: "Under 25", Count: 0 },
          { Label: "25–34", Count: 0 },
          { Label: "35–44", Count: 0 },
          { Label: "45–54", Count: 0 },
          { Label: "55+", Count: 0 },
          { Label: "Unknown", Count: 0 },
        ];

        aEmployees.forEach(
          function (oEmployee) {
            var sLabel;

            if (sKey === "Age") {
              var iAge = this._getAge(oEmployee.BirthDate);
              var iGroup = 5;

              if (iAge !== null) {
                if (iAge < 25) {
                  iGroup = 0;
                } else if (iAge < 35) {
                  iGroup = 1;
                } else if (iAge < 45) {
                  iGroup = 2;
                } else if (iAge < 55) {
                  iGroup = 3;
                } else {
                  iGroup = 4;
                }
              }

              aAgeGroups[iGroup].Count += 1;
              return;
            }

            if (sKey === "Department") {
              sLabel = oEmployee.DeptName;
            } else if (sKey === "Gender") {
              sLabel = oEmployee.GenderText;
            } else if (sKey === "Job") {
              sLabel = oEmployee.JobTitle;
            } else {
              var oHire = this._toDate(oEmployee.HireDate);
              sLabel = oHire ? String(oHire.getUTCFullYear()) : "Unknown";
            }

            sLabel = sLabel || "Unknown";
            mCounts[sLabel] = (mCounts[sLabel] || 0) + 1;
          }.bind(this),
        );

        if (sKey === "Age") {
          if (!aAgeGroups[5].Count) {
            aAgeGroups.pop();
          }

          return aAgeGroups;
        }

        if (sKey === "Hire") {
          var aYears = Object.keys(mCounts)
            .filter(function (sYear) {
              return sYear !== "Unknown";
            })
            .map(Number)
            .sort(function (a, b) {
              return a - b;
            });

          var aHireRows = [];

          if (aYears.length) {
            for (
              var iYear = aYears[0];
              iYear <= aYears[aYears.length - 1];
              iYear += 1
            ) {
              aHireRows.push({
                Label: String(iYear),
                Count: mCounts[String(iYear)] || 0,
              });
            }
          }

          if (mCounts.Unknown) {
            aHireRows.push({
              Label: "Unknown",
              Count: mCounts.Unknown,
            });
          }

          return aHireRows;
        }

        return Object.keys(mCounts)
          .sort()
          .map(function (sLabel) {
            return {
              Label: sLabel,
              Count: mCounts[sLabel],
            };
          });
      },

      _toDate: function (vDate) {
        if (vDate === null || vDate === undefined || vDate === "") {
          return null;
        }

        var oDate;

        if (vDate instanceof Date) {
          oDate = vDate;
        } else if (typeof vDate === "string") {
          var aMatch = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(vDate);

          oDate = aMatch ? new Date(Number(aMatch[1])) : new Date(vDate);
        } else if (typeof vDate === "number") {
          oDate = new Date(vDate);
        } else {
          return null;
        }

        return isNaN(oDate.getTime()) ? null : oDate;
      },

      _getAge: function (vBirthDate) {
        var oBirth = this._toDate(vBirthDate);

        if (!oBirth) {
          return null;
        }

        var oToday = new Date();
        var iAge = oToday.getFullYear() - oBirth.getUTCFullYear();

        var iMonth = oToday.getMonth() - oBirth.getUTCMonth();

        if (
          iMonth < 0 ||
          (iMonth === 0 && oToday.getDate() < oBirth.getUTCDate())
        ) {
          iAge -= 1;
        }

        return iAge >= 0 ? iAge : null;
      },

      _formatDate: function (vDate) {
        var oDate = this._toDate(vDate);

        if (!oDate) {
          return "—";
        }

        return (
          ("0" + oDate.getUTCDate()).slice(-2) +
          "/" +
          ("0" + (oDate.getUTCMonth() + 1)).slice(-2) +
          "/" +
          oDate.getUTCFullYear()
        );
      },

      onColumnListItemPress: function (oEvent) {
        var oContext = oEvent.getSource().getBindingContext("dashboard");

        if (!oContext) {
          return;
        }

        var oEmployee = oContext.getObject();

        this.getView()
          .getModel("dashboard")
          .setProperty("/selectedEmployee", {
            EmpId: oEmployee.EmpId,
            EmpName: oEmployee.EmpName,
            DeptName: oEmployee.DeptName,
            GenderText: oEmployee.GenderText,
            JobTitle: oEmployee.JobTitle || "—",
            BirthDate: this._formatDate(oEmployee.BirthDate),
            HireDate: this._formatDate(oEmployee.HireDate),
          });

        if (!this._oEmployeeDialog) {
          this._createEmployeeDialog();
        }

        this._oEmployeeDialog.open();
      },

      _createEmployeeDialog: function () {
        var aContent = [];

        [
          ["Employee ID", "EmpId"],
          ["Full Name", "EmpName"],
          ["Department", "DeptName"],
          ["Gender", "GenderText"],
          ["Job Title", "JobTitle"],
          ["Birth Date", "BirthDate"],
          ["Hire Date", "HireDate"],
        ].forEach(
          function (aField) {
            aContent.push(
              new Label(
                this.getView().createId("idDetail" + aField[1] + "Label"),
                {
                  text: aField[0],
                },
              ),
            );

            aContent.push(
              new Text(
                this.getView().createId("idDetail" + aField[1] + "Text"),
                {
                  text: "{dashboard>/selectedEmployee/" + aField[1] + "}",
                },
              ),
            );
          }.bind(this),
        );

        var oForm = new SimpleForm(
          this.getView().createId("idEmployeeSimpleForm"),
          {
            editable: false,
            layout: "ResponsiveGridLayout",
            labelSpanXL: 4,
            labelSpanL: 4,
            labelSpanM: 4,
            labelSpanS: 12,
            emptySpanXL: 0,
            emptySpanL: 0,
            emptySpanM: 0,
            emptySpanS: 0,
            columnsXL: 1,
            columnsL: 1,
            columnsM: 1,
            content: aContent,
          },
        );

        this._oEmployeeDialog = new Dialog(
          this.getView().createId("idEmployeeDialog"),
          {
            title: "Employee Details",
            contentWidth: "34rem",
            draggable: true,
            resizable: true,
            content: [oForm],
            endButton: new Button(this.getView().createId("idCloseButton"), {
              text: "Close",
              press: function () {
                this._oEmployeeDialog.close();
              }.bind(this),
            }),
          },
        );

        this.getView().addDependent(this._oEmployeeDialog);
      },

      _getErrorMessage: function (oError) {
        if (!oError) {
          return "Unknown error";
        }

        if (oError.responseText) {
          try {
            var oResponse = JSON.parse(oError.responseText);
            var vMessage = oResponse.error && oResponse.error.message;

            if (typeof vMessage === "string") {
              return vMessage;
            }

            if (vMessage && vMessage.value) {
              return vMessage.value;
            }
          } catch {
            return (
              oError.message || oError.statusText || "Invalid server response."
            );
          }
        }

        return oError.message || oError.statusText || "Request failed";
      },
    });
  },
);
