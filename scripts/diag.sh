#!/usr/bin/env bash
# Diagnostik: hur skarp är MML:s flygbild per zoomnivå? Sparar rutor över en holme till data/diag/
KEY=$(grep -o 'mmlKey: "[^"]*"' config.js | cut -d'"' -f2)
mkdir -p data/diag; out=data/diag.md; echo "# Diagnostik $(date -u)" > $out
for z in 16 17 18; do
  read x y < <(python3 -c "import math;z=$z;la=60.03008;lo=19.90878;n=2**z;x=int((lo+180)/360*n);y=int((1-math.asinh(math.tan(math.radians(la)))/math.pi)/2*n);print(x,y)")
  r=$(curl -s -o data/diag/orto-z$z.jpg -w '%{http_code} %{size_download}' "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/WGS84_Pseudo-Mercator/$z/$y/$x.jpg?api-key=$KEY")
  echo "- z$z: $r" >> $out
done
# samma plats i ETRS-TM35FIN (LMV:s egen projektion), nivå 15 = 0,5 m/px
for z in 13 14 15; do
  read x y < <(python3 -c "
import math
la,lo=math.radians(60.03008),math.radians(19.90878)
a=6378137.0;f=1/298.257222101;e2=f*(2-f);ep2=e2/(1-e2);k0=0.9996;lo0=math.radians(27)
N=a/math.sqrt(1-e2*math.sin(la)**2);T=math.tan(la)**2;C=ep2*math.cos(la)**2;A=(lo-lo0)*math.cos(la)
M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*la-(3*e2/8+3*e2**2/32+45*e2**3/1024)*math.sin(2*la)+(15*e2**2/256+45*e2**3/1024)*math.sin(4*la)-(35*e2**3/3072)*math.sin(6*la))
E=500000+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)
Nn=k0*(M+N*math.tan(la)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720))
res=8192/2**$z; ox,oy=-548576,8388608
print(int((E-ox)/(res*256)), int((oy-Nn)/(res*256)))")
  r=$(curl -s -o data/diag/orto-tm35-z$z.jpg -w '%{http_code} %{size_download}' "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/ortokuva/default/ETRS-TM35FIN/$z/$y/$x.jpg?api-key=$KEY")
  echo "- tm35 z$z: $r" >> $out
done
cat $out
