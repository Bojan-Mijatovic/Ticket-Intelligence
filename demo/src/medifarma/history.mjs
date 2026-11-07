// MediFarma history: who built what, when, and the bugs fixed along the way (each fix is the commit of its ticket).
// Tickets CUP_FAR-2xx are seeded in Jira by demo/seed-jira.mjs --app medifarma (demo/src/medifarma/tickets.json).
// CUP_FAR-214 has no commit here: its cause was in MediLab and it was fixed there (CUP_LAB-115).
//
// The open demo ticket is not in this history: since CUP_LAB-118 (MediLab, October) creatinine comes in mg/dL, but
// RenalCheckService still divides by 88.4 as if it were µmol/L, so the eGFR is far too high and renal warnings are
// missing. It is created live with demo/new-ticket.mjs --scenario far-renal.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { B, H, T, cutter } from '../../lib/history.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cut = cutter(join(HERE, 'template'));

export const TITLE = 'MediFarma';
export const NEXT = `  node demo/run-mediagenda.mjs --project FAR     # backend :8082 + frontend :4202 (MediAgenda :8080, MediLab :8081)
  node demo/new-ticket.mjs --scenario far-renal    # the demo ticket (renal warning missing for metformin)`;

export const PEOPLE = {
  valentina: ['Valentina Rinaldi', 'valentina.rinaldi@example.com'],
  simone: ['Simone Galli', 'simone.galli@example.com'],
  elisa: ['Elisa Caruso', 'elisa.caruso@example.com'],
  // The same person as in MediLab: he built MediLab's results API and MediFarma's client of it.
  giorgio: ['Giorgio Esposito', 'giorgio.esposito@example.com'],
  bojan: ['Bojan Mijatović', '256592520+Bojan-Mijatovic@users.noreply.github.com'],
};

const BE = 'backend/src/main/java/com/medifarma';
const TEST = 'backend/src/test/java/com/medifarma';
const MIG = 'backend/src/main/resources/db/migration';
const FE = 'frontend/src/app';
const RX = `${BE}/prescription`;

const YML = 'backend/src/main/resources/application.yml';
const GEH = `${BE}/common/GlobalExceptionHandler.java`;
const H_BAD = cut(GEH, '    @ExceptionHandler(BadRequestException.class)', '    @ExceptionHandler(NotFoundException.class)');
const H_PEER = cut(GEH, '\n\n    @ExceptionHandler(PeerUnavailableException.class)', '\n}\n');
const MEDISUITE = cut(YML, '\n# The other applications', '\nlogging:');
const MEDILAB_URL = cut(YML, '  medilab:\n', '\nlogging:');

const ROUTES = `${FE}/app.routes.ts`;
const route = (path) => cut(ROUTES, `  {\n    path: '${path}',`, '  },\n') + '  },\n';
const R_LIST = route('prescrizioni');
const R_NEW = route('prescrizioni/nuova');
const R_DISPENSE = route('erogazione/:id');
const NAV = `${FE}/core/layout/sidenav.component.ts`;
const L_LIST = '      <a routerLink="/prescrizioni" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Prescrizioni</a>\n';
const L_NEW = '      <a routerLink="/prescrizioni/nuova" routerLinkActive="active">Nuova prescrizione</a>\n';

const MODELS = `${FE}/shared/models/farma.models.ts`;
const CATALOG = `${FE}/features/drugs/drug-catalog.component.ts`;
const STOCK_FE = `${FE}/features/stock/stock.component.ts`;
const DRUG_API = `${FE}/features/drugs/drug-api.service.ts`;
const RX_API = `${FE}/features/prescriptions/prescription-api.service.ts`;
const RX_LIST = `${FE}/features/prescriptions/prescription-list.component.ts`;
const RX_FORM = `${FE}/features/prescriptions/prescription-form.component.ts`;
const PANEL = `${FE}/features/prescriptions/warnings/warnings-panel.component.ts`;
const DISPENSE_FE = `${FE}/features/dispensing/dispensing.component.ts`;
const DISPENSE_SVC = `${BE}/dispensing/DispensingService.java`;
const SAFETY_TEST = `${TEST}/safety/SafetyServiceTest.java`;
const RX_TEST = `${TEST}/prescription/PrescriptionServiceTest.java`;
const DISPENSE_TEST = `${TEST}/dispensing/DispensingServiceTest.java`;

const BUG = {
  // CUP_FAR-204: the list showed 11/06/2026 for 6 November (month first)
  date: ["{{ p.issuedAt | date: 'dd/MM/yyyy HH:mm' }}", "{{ p.issuedAt | date: 'MM/dd/yyyy HH:mm' }}"],
  // CUP_FAR-206: FEFO took the expired metformin lot first
  expired: ['                    .filter(l -> !l.isExpiredOn(today))\n', ''],
  expiredDoc: ['(first expired, first out). Expired lots are never\n * used.', '(first expired, first out).'],
  expiredTest: [cut(DISPENSE_TEST, '    @Test\n    void neverUsesAnExpiredLot', '    @Test\n    void notEnoughPacksIsAConflictAndNothingIsHandedOut'), ''],
  // CUP_FAR-207: too few packs: what was there was handed out and the prescription marked dispensed anyway
  allOrNothing: [cut(DISPENSE_SVC, '            if (missing > 0) {', '        rx.dispensed();'), '        }\n'],
  allOrNothingDoc: [' All or nothing: when a drug has too few packs, no lot is touched.', ''],
  allOrNothingTest: [cut(DISPENSE_TEST, '    @Test\n    void notEnoughPacksIsAConflictAndNothingIsHandedOut', '    @Test\n    void aPrescriptionIsDispensedOnce'), ''],
  // CUP_FAR-208: rows are shown by name, but Rimuovi removed by position in the unsorted list
  removeRow: ['(click)="remove(row)"', '(click)="remove(i)"'],
  removeRowIndex: ['@for (row of rows(); track row.rowId) {', '@for (row of rows(); track row.rowId; let i = $index) {'],
  removeRowMethod: ['  remove(row: Row): void {\n    this.items.update((list) => list.filter((x) => x.rowId !== row.rowId));\n  }',
    '  remove(index: number): void {\n    this.items.update((list) => list.filter((_, j) => j !== index));\n  }'],
  // CUP_FAR-210: the rule warfarin + ibuprofene was not found for ibuprofene + warfarin
  eitherOrder: ['        return (ingredientA.equalsIgnoreCase(first) && ingredientB.equalsIgnoreCase(second))\n                || (ingredientA.equalsIgnoreCase(second) && ingredientB.equalsIgnoreCase(first));',
    '        return ingredientA.equalsIgnoreCase(first) && ingredientB.equalsIgnoreCase(second);'],
  eitherOrderDoc: ['    /** Whether the rule is about these two ingredients, in either order. */', '    /** Whether the rule is about these two ingredients. */'],
  eitherOrderTest: ['\n        assertThat(service.check(new SafetyRequest(1L, List.of(IBUPROFENE, WARFARIN, RAMIPRIL))).warnings())\n                .extracting(Warning::severity).containsExactly(Warning.ALTA, Warning.MEDIA);', ''],
  // CUP_FAR-212: after Rimuovi the warnings of the removed drug stayed (and blocked EMETTI)
  staleWarnings: ['    this.runCheck(); // the warnings of the removed drug must go as well\n', ''],
  // CUP_FAR-213: women's eGFR with the male constants (too low: renal warnings for healthy women)
  female: ['        double kappa = female ? 0.7 : 0.9;\n        double alpha = female ? -0.241 : -0.302;', '        double kappa = 0.9;\n        double alpha = -0.302;'],
  femaleTest: ['        assertThat(RenalFunction.egfr(1.0, 50, "F")).isEqualTo(69);\n        assertThat(RenalFunction.egfr(0.7, 40, "F")).isEqualTo(112);\n', ''],
  // CUP_FAR-215: no creatinine in MediLab → Optional.get() → error 500 on Nuova prescrizione
  noCreatinine: [cut(`${BE}/safety/RenalCheckService.java`, '        Optional<LabValue> latest = ', '        // MediLab reports'), '        LabValue creatinine = mediLab.latestCreatinine(patient.fiscalCode()).get();\n'],
  noCreatinineImport: ['import java.util.Optional;\n', ''],
  noCreatinineTest: [cut(SAFETY_TEST, '\n\n    @Test\n    void withoutACreatinineTheRenalCheckIsSkippedNotFailed', '\n}\n'), ''],
  // CUP_FAR-216: a double click on EROGA sent two requests
  doubleClick: ['    // A double click must not send two requests: the second one would hand the drugs out again.\n    if (this.busy()) return;\n    this.busy.set(true);\n', ''],
  doubleClickButton: ['[disabled]="busy() || p.status !== \'EMESSA\'"', '[disabled]="p.status !== \'EMESSA\'"'],
  // CUP_FAR-217: a DISPENSATA prescription could be cancelled (and its drugs were already out)
  cancel: ['    void cancel() {\n        requireIssued("cancelled");\n        status = ANNULLATA;', '    void cancel() {\n        status = ANNULLATA;'],
  cancelTest: [cut(RX_TEST, '\n\n    @Test\n    void aDispensedPrescriptionCannotBeCancelled', '\n}\n'), ''],
};

// Features that came later than the files they live in.
const LATER = {
  // CUP_FAR-211: renal rules of the drugs and the eGFR of a prescription
  renalDoc: ['\n * Drugs cleared by the kidneys carry a renal rule: reduce the dose below an eGFR, avoid it below another.', ''],
  renalFields: [cut(`${BE}/drug/Drug.java`, '    @Column(name = "renal_reduce_below")', '\n    protected Drug() {}'), ''],
  renalGetters: [cut(`${BE}/drug/Drug.java`, '\n    public Integer getRenalReduceBelow()', '\n}\n'), ''],
  renalModel: ['  renalReduceBelow: number | null;\n  renalAvoidBelow: number | null;\n  renalNote: string | null;\n', ''],
  renalCatalogHead: ['<th>Funzione renale</th>', ''],
  renalCatalogCell: ['\n              <td>{{ renal(d) }}</td>', ''],
  renalCatalogMethod: [cut(CATALOG, '\n\n  renal(d: Drug): string {', '\n}\n'), ''],
  renalCatalogDoc: [', with the renal dose rules of the drugs cleared by the kidneys', ''],
  egfrField: ['    /** The eGFR the renal check used when the prescription was issued (null: no creatinine in MediLab). */\n    private Integer egfr;\n', ''],
  egfrIssue: ['List<PrescriptionItem> items, Integer egfr, boolean acknowledged, LocalDateTime now)', 'List<PrescriptionItem> items, boolean acknowledged, LocalDateTime now)'],
  egfrAssign: ['        rx.egfr = egfr;\n', ''],
  egfrGetter: ['    public Integer getEgfr() { return egfr; }\n', ''],
  egfrService: ['items, check.egfr(), !high.isEmpty(), now)', 'items, !high.isEmpty(), now)'],
  egfrView: ['p.getIssuedAt(), p.getEgfr(), p.isWarningsAcknowledged()', 'p.getIssuedAt(), p.isWarningsAcknowledged()'],
  egfrRecord: ['        Integer egfr,\n', ''],
  egfrListHead: ['<th class="num">eGFR</th>', ''],
  egfrListCell: ["\n              <td class=\"num\">{{ p.egfr ?? '–' }}</td>", ''],
  egfrListEmpty: ['colspan="7"', 'colspan="6"'],
  kidneyPanel: [cut(PANEL, '        <div class="kidney"', '        @if (c.warnings.length) {'), ''],
  kidneyPanelDoc: [" * The checks of the prescription being written: the patient's kidney function (eGFR from the MediLab creatinine)\n * and the warnings.", ' * The checks of the prescription being written: the warnings.'],
  kidneyPanelImports: ["import { DatePipe, DecimalPipe } from '@angular/common';\n", ''],
  kidneyPanelImports2: ['  imports: [DatePipe, DecimalPipe],\n', '  imports: [],\n'],
  renalTests: [cut(SAFETY_TEST, '    @Test\n    void metforminIsContraindicatedBelowAnEgfrOf30', '    @Test\n    void interactionsAreFoundInEitherOrder'), ''],
  fakeLab: ['\n    @Autowired\n    FakeMediLabClient mediLab;\n\n    @AfterEach\n    void defaults() {\n        mediLab.reset();\n    }\n', ''],
  fakeLabImports: ['import com.medifarma.integration.FakeMediLabClient;\n', ''],
  fakeLabImports2: ['import org.junit.jupiter.api.AfterEach;\n', ''],
  ackTest: [cut(RX_TEST, '    @Test\n    void highWarningsMustBeAcknowledged', '    @Test\n    void rejectsAPatientThatIsNotInMediAgenda'), ''],
  ackModel: ['  acknowledgeWarnings: boolean;\n', ''],
  ackDispenseTest: ['new PrescriptionRequest(1L, "Dr. Marco Fumagalli", false,', 'new PrescriptionRequest(1L, "Dr. Marco Fumagalli",'],
  checkApi: [cut(RX_API, '\n\n  /** The checks of the prescription being written', '\n}\n'), ''],
  checkApiImport: ['import { PrescriptionRequest, PrescriptionView, SafetyCheck } from', 'import { PrescriptionRequest, PrescriptionView } from'],
  // CUP_FAR-218: lots expiring within 60 days
  expiringApi: [cut(STOCK_FE.replace('stock/stock.component.ts', 'drugs/drug-api.service.ts'), '\n\n  /** Lots with packs left that expire', '\n}\n'), ''],
  expiringBe: [cut(`${BE}/stock/StockController.java`, '    /** GET /api/stock/expiring', '    private static StockRow row('), ''],
  expiringBeImport: ['import org.springframework.web.bind.annotation.RequestParam;\n', ''],
  expiringFeLabel: ['\n        <label class="check-row"><input id="only-expiring" type="checkbox" name="expiring" [(ngModel)]="onlyExpiring" (ngModelChange)="load()" /> Solo lotti in scadenza (60 giorni)</label>', ''],
  expiringFeLoad: ['(this.onlyExpiring ? this.api.expiring(60) : this.api.stock())', 'this.api.stock()'],
  expiringFeField: ['  onlyExpiring = false;\n', ''],
  expiringFeDoc: ['; optionally only what expires soon', ''],
};
const RENAL_DRUG = [LATER.renalDoc, LATER.renalFields, LATER.renalGetters];
const RENAL_CATALOG = [LATER.renalCatalogHead, LATER.renalCatalogCell, LATER.renalCatalogMethod, LATER.renalCatalogDoc];
const EGFR_RX = [LATER.egfrField, LATER.egfrIssue, LATER.egfrAssign, LATER.egfrGetter];
const EGFR_LIST = [LATER.egfrListHead, LATER.egfrListCell, LATER.egfrListEmpty];
const KIDNEY_PANEL = [LATER.kidneyPanel, LATER.kidneyPanelDoc, LATER.kidneyPanelImports, LATER.kidneyPanelImports2];
const NO_RENAL_TESTS = [LATER.renalTests, LATER.fakeLab, LATER.fakeLabImports, LATER.fakeLabImports2, BUG.noCreatinineTest];
const EXPIRING_FE = [LATER.expiringFeLabel, LATER.expiringFeLoad, LATER.expiringFeField, LATER.expiringFeDoc];
const FORM_03 = B(H('08-form'), BUG.removeRow, BUG.removeRowIndex, BUG.removeRowMethod);

export const STEPS = [
  {
    who: 'valentina', date: '2026-03-10T10:00:00+01:00',
    message: 'CUP_FAR-201: backend skeleton, formulary and stock by lot (Flyway V1)\n\nGET /api/drugs (by name or active ingredient) and GET /api/stock: usable packs per drug (expired lots do not count).',
    files: {
      '.gitignore': T, 'README.md': H('01-backend'), 'backend/pom.xml': T, [YML]: B(T, [MEDISUITE, '']),
      [`${BE}/MediFarmaApplication.java`]: T, [`${BE}/common/ApiError.java`]: T, [`${BE}/common/NotFoundException.java`]: T,
      [`${BE}/common/ConflictException.java`]: T, [GEH]: B(T, [H_BAD, ''], [H_PEER, '']),
      [`${BE}/drug/Drug.java`]: B(T, ...RENAL_DRUG), [`${BE}/drug/DrugRepository.java`]: T, [`${BE}/drug/DrugController.java`]: T,
      [`${BE}/stock/Lot.java`]: T, [`${BE}/stock/LotRepository.java`]: T, [`${BE}/stock/StockRow.java`]: T,
      [`${BE}/stock/StockController.java`]: B(T, LATER.expiringBe, LATER.expiringBeImport), [`${MIG}/V1__drugs_and_stock.sql`]: T,
    },
  },
  {
    who: 'simone', date: '2026-03-17T15:20:00+01:00',
    message: 'CUP_FAR-202: frontend skeleton: app shell, layout, Farmaci and Magazzino pages',
    files: {
      'frontend/package.json': T, 'frontend/angular.json': T, 'frontend/tsconfig.json': T, 'frontend/tsconfig.app.json': T, 'frontend/proxy.conf.json': T,
      'frontend/src/index.html': T, 'frontend/src/main.ts': T, 'frontend/src/styles.scss': T,
      [`${FE}/app.config.ts`]: T, [`${FE}/app.component.ts`]: T,
      [ROUTES]: B(T, ["redirectTo: 'prescrizioni'", "redirectTo: 'farmaci'"], [R_LIST, ''], [R_NEW, ''], [R_DISPENSE, '']),
      [`${FE}/core/http/api.ts`]: T, [`${FE}/core/http/api-errors.ts`]: T, [`${FE}/core/i18n/labels.ts`]: T,
      [`${FE}/core/layout/header.component.ts`]: T, [NAV]: B(T, [L_LIST, ''], [L_NEW, '']),
      [MODELS]: B(T, LATER.renalModel, LATER.ackModel), [DRUG_API]: B(T, LATER.expiringApi),
      [CATALOG]: B(T, ...RENAL_CATALOG), [STOCK_FE]: B(T, ...EXPIRING_FE),
    },
  },
  {
    who: 'elisa', date: '2026-04-01T10:30:00+02:00',
    message: 'CUP_FAR-203: prescriptions for MediAgenda patients (Flyway V2)\n\nPOST /api/prescriptions takes a MediAgenda patientId (read from GET /api/patients/{id} there, copied into the\nprescription) and the drugs with posology, days and packs. The MediAgenda client reports a MediAgenda that does\nnot answer as 502, as MediLab does since CUP_LAB-113.',
    files: {
      [YML]: B(T, [MEDILAB_URL, ''], ['(MediAgenda: patient registry; MediLab: laboratory results)', '(MediAgenda: patient registry)']), [`${BE}/common/BadRequestException.java`]: T, [`${BE}/common/PeerUnavailableException.java`]: T, [GEH]: T,
      [`${BE}/integration/PatientInfo.java`]: T, [`${BE}/integration/MediAgendaClient.java`]: T, [`${BE}/integration/HttpMediAgendaClient.java`]: T,
      [`${BE}/integration/PatientLookupController.java`]: T,
      [`${RX}/PrescriptionItem.java`]: T, [`${RX}/Prescription.java`]: H('03-prescriptions'), [`${RX}/PrescriptionRequest.java`]: H('03-prescriptions'),
      [`${RX}/PrescriptionView.java`]: H('03-prescriptions'), [`${RX}/PrescriptionRepository.java`]: T, [`${RX}/PrescriptionService.java`]: H('03-prescriptions'),
      [`${RX}/PrescriptionController.java`]: T, [`${MIG}/V2__prescriptions.sql`]: T,
      [`${TEST}/integration/FakeMediAgendaClient.java`]: T, [RX_TEST]: H('03-prescriptions'),
    },
  },
  {
    who: 'elisa', date: '2026-04-03T16:00:00+02:00',
    message: 'CUP_FAR-203: Prescrizioni list and Nuova prescrizione form with the MediAgenda patient picker',
    files: {
      [ROUTES]: B(T, [R_DISPENSE, '']), [NAV]: T,
      [`${FE}/shared/services/mediagenda-api.service.ts`]: T, [`${FE}/shared/components/patient-picker/patient-picker.component.ts`]: T,
      [RX_API]: B(T, LATER.checkApi, LATER.checkApiImport), [RX_LIST]: B(T, BUG.date, ...EGFR_LIST), [RX_FORM]: FORM_03,
    },
  },
  {
    who: 'simone', date: '2026-04-15T11:10:00+02:00',
    message: 'CUP_FAR-204: Prescrizioni shows dates as dd/MM/yyyy\n\nThe list used the MM/dd/yyyy pattern: a prescription of 6 November showed as 11/06/2026.',
    files: { [RX_LIST]: B(T, ...EGFR_LIST) },
  },
  {
    who: 'valentina', date: '2026-04-28T09:40:00+02:00',
    message: 'CUP_FAR-205: dispensing from stock, lot by lot in FEFO order (Flyway V3)\n\nPOST /api/prescriptions/{id}/dispense takes the packs from the lot that expires first; the prescription is DISPENSATA.',
    files: {
      [`${BE}/dispensing/DispensedLine.java`]: T, [`${BE}/dispensing/Dispensing.java`]: T, [`${BE}/dispensing/DispensingRepository.java`]: T,
      [`${BE}/dispensing/DispensingView.java`]: T, [DISPENSE_SVC]: B(T, BUG.allOrNothing, BUG.allOrNothingDoc, BUG.expired, BUG.expiredDoc),
      [`${BE}/dispensing/DispensingController.java`]: T, [`${MIG}/V3__dispensings.sql`]: T,
      [DISPENSE_TEST]: B(T, BUG.expiredTest, BUG.allOrNothingTest, LATER.ackDispenseTest),
    },
  },
  {
    who: 'simone', date: '2026-05-05T14:30:00+02:00',
    message: 'CUP_FAR-205: Erogazione page',
    files: { [ROUTES]: T, [`${FE}/features/dispensing/dispensing-api.service.ts`]: T, [DISPENSE_FE]: B(T, BUG.doubleClick, BUG.doubleClickButton) },
  },
  {
    who: 'valentina', date: '2026-05-12T10:20:00+02:00',
    message: 'CUP_FAR-206: dispensing never uses an expired lot\n\nFEFO sorted all lots by expiry, so the expired metformin lot L-MF2601 was handed out first.',
    files: { [DISPENSE_SVC]: B(T, BUG.allOrNothing, BUG.allOrNothingDoc), [DISPENSE_TEST]: B(T, BUG.allOrNothingTest, LATER.ackDispenseTest) },
  },
  {
    who: 'valentina', date: '2026-05-26T15:45:00+02:00',
    message: 'CUP_FAR-207: dispensing is all or nothing\n\nWith too few packs the available ones were handed out and the prescription was marked DISPENSATA anyway.\nNow it is refused (409, "3 of 5") and no lot is touched.',
    files: { [DISPENSE_SVC]: T, [DISPENSE_TEST]: B(T, LATER.ackDispenseTest) },
  },
  {
    who: 'simone', date: '2026-06-03T11:00:00+02:00',
    message: 'CUP_FAR-208: Nuova prescrizione: Rimuovi removes the drug of its row\n\nThe rows are shown by drug name but were removed by their position in the order they were added, so another drug\ndisappeared.',
    files: { [RX_FORM]: H('08-form') },
  },
  {
    who: 'elisa', date: '2026-06-16T10:15:00+02:00',
    message: 'CUP_FAR-209: interaction check and acknowledgement of high warnings (Flyway V4)\n\nPOST /api/safety/check returns the warnings of a prescription (pairs of active ingredients). A prescription with\nALTA warnings is refused (409) unless the prescriber acknowledges them (acknowledgeWarnings).',
    files: {
      [`${BE}/safety/Warning.java`]: T, [`${BE}/safety/InteractionRule.java`]: B(T, BUG.eitherOrder, BUG.eitherOrderDoc), [`${BE}/safety/InteractionRuleRepository.java`]: T,
      [`${BE}/safety/SafetyCheck.java`]: T, [`${BE}/safety/SafetyRequest.java`]: T, [`${BE}/safety/SafetyService.java`]: H('09-interactions'), [`${BE}/safety/SafetyController.java`]: T,
      [`${RX}/Prescription.java`]: B(T, BUG.cancel, ...EGFR_RX), [`${RX}/PrescriptionRequest.java`]: T,
      [`${RX}/PrescriptionView.java`]: B(T, LATER.egfrRecord), [`${RX}/PrescriptionService.java`]: B(T, LATER.egfrService, LATER.egfrView),
      [`${MIG}/V4__interactions.sql`]: T,
      [SAFETY_TEST]: B(T, ...NO_RENAL_TESTS, BUG.eitherOrderTest), [RX_TEST]: B(T, LATER.ackTest, BUG.cancelTest), [DISPENSE_TEST]: T,
      [MODELS]: B(T, LATER.renalModel), [RX_API]: T, [PANEL]: B(T, ...KIDNEY_PANEL), [RX_FORM]: B(T, BUG.staleWarnings),
    },
  },
  {
    who: 'elisa', date: '2026-06-30T09:50:00+02:00',
    message: 'CUP_FAR-210: interactions are found whichever drug comes first\n\nThe rule "warfarin + ibuprofene" was not found for a prescription with ibuprofene first.',
    files: { [`${BE}/safety/InteractionRule.java`]: T, [SAFETY_TEST]: B(T, ...NO_RENAL_TESTS) },
  },
  {
    who: 'giorgio', date: '2026-07-23T11:30:00+02:00',
    message: 'CUP_FAR-211: MediLab client: the latest validated creatinine of a patient\n\nReads GET /api/patients/{fiscalCode}/results?exam=CREA of MediLab (CUP_LAB-114), newest first.',
    files: {
      [YML]: T, [`${BE}/integration/LabValue.java`]: T, [`${BE}/integration/MediLabClient.java`]: T, [`${BE}/integration/HttpMediLabClient.java`]: T,
      [`${TEST}/integration/FakeMediLabClient.java`]: T,
    },
  },
  {
    who: 'valentina', date: '2026-07-28T16:10:00+02:00',
    message: 'CUP_FAR-211: renal dose check with the MediLab creatinine (eGFR CKD-EPI 2021, Flyway V5)\n\nThe eGFR comes from the latest MediLab creatinine (µmol/L, converted to mg/dL for the equation), the patient\'s age\nand sex. Drugs with a renal rule give an ALTA warning below renal_avoid_below and a MEDIA one below\nrenal_reduce_below. The eGFR is shown in Nuova prescrizione and kept on the prescription.',
    files: {
      [`${BE}/safety/RenalFunction.java`]: B(T, BUG.female), [`${BE}/safety/RenalCheck.java`]: T,
      [`${BE}/safety/RenalCheckService.java`]: B(T, BUG.noCreatinine, BUG.noCreatinineImport), [`${BE}/safety/SafetyService.java`]: T,
      [`${BE}/drug/Drug.java`]: T, [`${RX}/Prescription.java`]: B(T, BUG.cancel), [`${RX}/PrescriptionView.java`]: T, [`${RX}/PrescriptionService.java`]: T,
      [`${MIG}/V5__renal_rules.sql`]: T,
      [`${TEST}/safety/RenalFunctionTest.java`]: B(T, BUG.femaleTest), [SAFETY_TEST]: B(T, BUG.noCreatinineTest), [RX_TEST]: B(T, BUG.cancelTest),
      [MODELS]: T, [CATALOG]: T, [PANEL]: T, [RX_LIST]: T,
    },
  },
  {
    who: 'simone', date: '2026-08-05T10:40:00+02:00',
    message: 'CUP_FAR-212: Nuova prescrizione: the warnings are checked again after Rimuovi\n\nThe warnings of a removed drug stayed in the panel, and an ALTA one kept EMETTI disabled.',
    files: { [RX_FORM]: T },
  },
  {
    who: 'valentina', date: '2026-08-18T14:20:00+02:00',
    message: 'CUP_FAR-213: eGFR of women with the female CKD-EPI constants\n\nκ = 0.7 and α = -0.241 for women were not applied: the eGFR of women was too low, with renal warnings for\nhealthy kidneys. Reference values added to RenalFunctionTest.',
    files: { [`${BE}/safety/RenalFunction.java`]: T, [`${TEST}/safety/RenalFunctionTest.java`]: T },
  },
  {
    who: 'giorgio', date: '2026-09-02T09:30:00+02:00',
    message: 'CUP_FAR-215: Nuova prescrizione works for a patient without a creatinine in MediLab\n\nThe renal check called Optional.get() on an empty result: error 500. Now it is skipped with an INFO warning.',
    files: { [`${BE}/safety/RenalCheckService.java`]: T, [SAFETY_TEST]: T },
  },
  {
    who: 'simone', date: '2026-09-22T15:00:00+02:00',
    message: 'CUP_FAR-216: Erogazione: a double click dispenses once\n\nEROGA stayed enabled while the request was running; two requests handed the drugs out twice.',
    files: { [DISPENSE_FE]: T },
  },
  {
    who: 'elisa', date: '2026-10-06T11:20:00+02:00',
    message: 'CUP_FAR-217: a dispensed prescription can no longer be cancelled',
    files: { [`${RX}/Prescription.java`]: T, [RX_TEST]: T },
  },
  {
    who: 'simone', date: '2026-10-20T16:30:00+02:00',
    message: 'CUP_FAR-218: Magazzino: lots expiring within 60 days\n\nGET /api/stock/expiring?days=60 and a filter on the Magazzino page.',
    files: { [`${BE}/stock/StockController.java`]: T, [DRUG_API]: T, [STOCK_FE]: T },
  },
  {
    who: 'bojan', date: '2026-11-04T18:45:00+01:00',
    message: 'Browser tests: Playwright with a mocked backend API (prescriptions, warnings, dispensing, stock)',
    files: {
      'README.md': T, 'e2e/package.json': T, 'e2e/playwright.config.ts': T, 'e2e/README.md': T,
      'e2e/support/evidence.ts': T, 'e2e/support/api-data.json': T, 'e2e/support/mock-api.ts': T, 'e2e/support/farma.ts': T,
      'e2e/tests/prescriptions.smoke.spec.ts': T, 'e2e/tests/dispensing.smoke.spec.ts': T, 'e2e/tests/stock.smoke.spec.ts': T,
    },
  },
];
