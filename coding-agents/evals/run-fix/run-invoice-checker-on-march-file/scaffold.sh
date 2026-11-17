#!/bin/sh
set -e
# The bank's runner puts stigmer-bank-fixture on PATH: before every try it puts back
# whatever an earlier try deleted or changed in the fixture this case reads.
if command -v stigmer-bank-fixture >/dev/null 2>&1; then stigmer-bank-fixture; fi
mkdir -p samples
cat > samples/march.csv <<'EOF'
invoice,vendor,purchase_order,amount
INV-3101,Northwind Traders,PO-1201,3295.27
INV-3102,Contoso Supplies,PO-1202,1631.17
INV-3103,Fabrikam,PO-1203,6441.99
INV-3104,Harbor Office Supply,PO-1204,876.84
INV-3105,Atlas Freight,PO-1205,5335.18
INV-3106,Pinecrest Janitorial,PO-1206,3697.93
INV-3107,Summit IT Services,PO-1207,737.95
INV-3108,Riverbend Printing,PO-1208,5061.53
INV-3109,Northwind Traders,PO-1209,540.71
INV-3110,Contoso Supplies,PO-1210,4351.67
INV-3111,Fabrikam,PO-1211,852.01
INV-3112,Harbor Office Supply,PO-1212,1052.66
INV-3113,Atlas Freight,PO-1213,4263.87
INV-3114,Pinecrest Janitorial,PO-1214,8134.32
INV-3115,Summit IT Services,PO-1215,1370.97
INV-3116,Riverbend Printing,PO-1216,2327.56
INV-3117,Northwind Traders,PO-1217,6215.91
INV-3118,Contoso Supplies,PO-1218,9296.96
INV-3119,Fabrikam,PO-1219,5731.73
INV-3120,Harbor Office Supply,PO-1220,3996.07
INV-3121,Atlas Freight,PO-1221,9571.57
INV-3122,Pinecrest Janitorial,PO-1222,628.13
INV-3123,Summit IT Services,PO-1223,8438.47
INV-3124,Riverbend Printing,PO-1224,2966.04
INV-3125,Northwind Traders,PO-1225,1567.73
INV-3126,Contoso Supplies,PO-1226,1313.16
INV-3127,Fabrikam,PO-1227,3147.60
INV-3128,Harbor Office Supply,PO-1228,8031.14
INV-3129,Atlas Freight,PO-1229,1918.59
INV-3130,Pinecrest Janitorial,PO-1230,5774.99
INV-3131,Summit IT Services,PO-1231,6326.35
INV-3132,Riverbend Printing,PO-1232,3762.46
INV-3133,Northwind Traders,PO-1233,5449.30
INV-3134,Contoso Supplies,PO-1234,784.03
INV-3135,Fabrikam,PO-1235,753.36
INV-3136,Harbor Office Supply,PO-1236,2161.32
INV-3137,Atlas Freight,PO-1237,6725.45
INV-3138,Pinecrest Janitorial,PO-1238,4293.44
INV-3139,Summit IT Services,PO-1239,3202.10
INV-3140,Riverbend Printing,PO-1240,5813.11
INV-3141,Northwind Traders,PO-1241,4539.63
EOF
