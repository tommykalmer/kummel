import math, sys
la, lo, z = math.radians(float(sys.argv[1])), math.radians(float(sys.argv[2])), int(sys.argv[3])
a = 6378137.0; f = 1 / 298.257222101; e2 = f * (2 - f); ep2 = e2 / (1 - e2); k0 = 0.9996; lo0 = math.radians(27)
N = a / math.sqrt(1 - e2 * math.sin(la) ** 2); T = math.tan(la) ** 2; C = ep2 * math.cos(la) ** 2; A = (lo - lo0) * math.cos(la)
M = a * ((1 - e2/4 - 3*e2**2/64 - 5*e2**3/256) * la - (3*e2/8 + 3*e2**2/32 + 45*e2**3/1024) * math.sin(2*la) + (15*e2**2/256 + 45*e2**3/1024) * math.sin(4*la) - (35*e2**3/3072) * math.sin(6*la))
E = 500000 + k0 * N * (A + (1 - T + C) * A**3 / 6 + (5 - 18*T + T*T + 72*C - 58*ep2) * A**5 / 120)
Nn = k0 * (M + N * math.tan(la) * (A*A/2 + (5 - T + 9*C + 4*C*C) * A**4 / 24 + (61 - 58*T + T*T + 600*C - 330*ep2) * A**6 / 720))
res = 8192 / 2 ** z
print(int((E + 548576) / (res * 256)), int((8388608 - Nn) / (res * 256)))
