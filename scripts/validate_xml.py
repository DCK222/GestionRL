from pathlib import Path
from lxml import etree
base=Path(__file__).resolve().parents[1]
class LocalResolver(etree.Resolver):
 def resolve(self,url,pubid,context):
  if url.endswith('xmldsig-core-schema.xsd'):return self.resolve_filename(str(base/'docs/aeat/xmldsig-core-schema.xsd'),context)
parser=etree.XMLParser(no_network=True,resolve_entities=False)
parser.resolvers.add(LocalResolver())
schema=etree.XMLSchema(etree.parse(str(base/'docs/aeat/SuministroLR.xsd'),parser))
for name in ['alta.xml','rectificativa.xml']:
 doc=etree.parse(str(base/'private-import/test-results'/name),parser)
 body=doc.find('{http://schemas.xmlsoap.org/soap/envelope/}Body')
 schema.assertValid(body[0])
 print('PASS: '+name+' cumple el esquema oficial XSD de la AEAT')
