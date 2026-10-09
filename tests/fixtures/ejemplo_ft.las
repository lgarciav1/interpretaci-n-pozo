# Fixture de prueba: LAS 2.0, profundidad en pies, NULL -999.25
~VERSION INFORMATION
 VERS.                  2.0   : CWLS LOG ASCII STANDARD - VERSION 2.0
 WRAP.                  NO    : ONE LINE PER DEPTH STEP
~WELL INFORMATION
#MNEM.UNIT      DATA                  DESCRIPTION
 STRT.FT        5000.0000   : START DEPTH
 STOP.FT        5003.0000   : STOP DEPTH
 STEP.FT        0.5000      : STEP
 NULL.          -999.25     : NULL VALUE
 COMP.          PETROLERA DEL SUR   : COMPANY
 WELL.          POZO EJEMPLO-1      : WELL
 FLD .          CAMPO NORTE         : FIELD
 UWI .          05-123-45678        : UNIQUE WELL ID
 DATE.          2020-03-15 12:30:00 : LOG DATE
~CURVE INFORMATION
#MNEM.UNIT      API CODE         : CURVE DESCRIPTION
 DEPT.FT                         : 1  DEPTH
 GR  .GAPI      45 310 01 00     : 2  GAMMA RAY
 RHOB.G/CC      45 350 01 00     : 3  BULK DENSITY
 NPHI.V/V                        : 4  NEUTRON POROSITY
 ILD .OHMM                       : 5  DEEP RESISTIVITY
~PARAMETER INFORMATION
 KB  .FT        45.0             : KELLY BUSHING
~OTHER
 Texto libre que el lector debe ignorar.

~ASCII LOG DATA
# DEPT GR RHOB NPHI ILD
 5000.0  45.0     2.30    0.20     10.0
 5000.5  50.0     2.35    0.22      8.0

 5001.0  -999.25  2.40    0.25   -999.25
 5001.5  60.0  -999.25    0.28      5.0
 5002.0  70.0     2.50    0.30      4.0
 5002.5  80.0     2.55 -999.25      3.0
 5003.0  90.0     2.60    0.35      2.0
