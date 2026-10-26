import fs from 'node:fs';
import {fixtureTables,csv} from './tests/planfit-fixture.mjs';
for(const [kind,rows] of Object.entries(fixtureTables()))fs.writeFileSync('tests/fixtures/planfit/'+kind+'.csv',csv(kind,rows));
fs.writeFileSync('tests/fixtures/planfit/README.txt','Synthetic Planfit-shaped test data. These files contain no user export or real training history.');
