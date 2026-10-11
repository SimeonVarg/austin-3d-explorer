import copy
import json
from pathlib import Path
import tempfile
import unittest
from accept import Rejected
import detail


class DetailTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.recipe=self.root/'baseline.json';self.spec=self.root/'spec.json';self.out=self.root/'candidate.json'
        self.baseline={'colours':{'old':'#ffffff'},'materials':{},'blocks':[{'id':'retain'}],
                       'detailMeshes':[{'id':'old','vertices':[[0,0,0]],'triangles':[]}]}
        self.recipe.write_text(json.dumps(self.baseline))
        self.pose=self.root/'pose.json';self.pose.write_text(json.dumps(dict(camera=[0,0,1.6],ground_z=None)))
        self.value={'pose_evidence':str(self.pose),'prefix':'trial-','tones':{'trial':'#28473f'},'materials':{'trial':'metal'},'features':[
            {'id':'table','kind':'picnic_table','at':[0,0,.16],'tone':'trial','_src':{'type':'inference'},
             'parameters':{'width':1.25,'depth':1.25,'clip':.1,'topHeight':.76,'topThickness':.05,
                           'seatHeight':.44,'seatThickness':.045,'seatLength':1.12,'seatWidth':.27,
                           'seatOffset':1.0,'tubeRadius':.03,'bendRadius':.15,'postRadius':.03,'postSpacing':.3136,'bendSegments':4}}]}

    def run_build(self):
        self.spec.write_text(json.dumps(self.value));return detail.build(self.recipe,self.spec,self.out)

    def test_closed_finite_geometry_and_baseline_unchanged(self):
        receipt=self.run_build();new=json.loads(self.out.read_text())
        self.assertEqual(new['blocks'],self.baseline['blocks'])
        self.assertEqual(new['detailMeshes'][0],self.baseline['detailMeshes'][0])
        self.assertEqual(new['colours']['old'],'#ffffff')
        self.assertEqual(json.loads(self.recipe.read_text()),self.baseline)
        self.assertGreater(receipt['added_triangles'],100)
        # Every closed primitive has two faces at each undirected edge.
        mesh=new['detailMeshes'][1];edges={}
        for tri in mesh['triangles']:
            a,b,c=[mesh['vertices'][i] for i in tri]
            ab=[b[i]-a[i] for i in range(3)];ac=[c[i]-a[i] for i in range(3)]
            cross=detail.geometry.cross(ab,ac)
            self.assertGreater(sum(x*x for x in cross),1e-16)
            for u,v in zip(tri,tri[1:]+tri[:1]):
                edge=tuple(sorted((u,v)));edges[edge]=edges.get(edge,0)+1
        self.assertTrue(all(count==2 for count in edges.values()))

    def test_reject_existing_colour_or_material_change(self):
        self.value['tones']['old']='#000000'
        with self.assertRaises(Rejected):self.run_build()
        self.assertFalse(self.out.exists())

    def test_rejected_camera_cannot_build_trial(self):
        self.pose.write_text(json.dumps(dict(camera=[0,0,-.1],ground_z=.16)))
        with self.assertRaises(Rejected):self.run_build()
        self.assertFalse(self.out.exists())

    def test_reject_intersecting_seat_and_bad_bend(self):
        for key,value in [('seatOffset',.4),('bendRadius',1),('width',float('nan'))]:
            original=self.value['features'][0]['parameters'][key]
            self.value['features'][0]['parameters'][key]=value
            with self.assertRaises(Rejected):self.run_build()
            self.value['features'][0]['parameters'][key]=original

    def test_rerun_cannot_duplicate_candidate(self):
        self.run_build()
        with self.assertRaises(Rejected):detail.build(self.out,self.spec,self.root/'twice.json')

    def test_other_components_and_evidence_required(self):
        self.value['features'] += [
            {'id':'ornament','kind':'wall_diamond','tone':'trial','wall':[[0,0],[5,0]],'centre':[2,5],
             'parameters':{'width':.5,'height':.5,'stroke':.035,'projection':.04},'_src':{'type':'inference'}},
            {'id':'soil','kind':'ground_inset','tone':'trial','at':[0,0,.165],
             'parameters':{'width':2,'depth':2,'clip':.4,'thickness':.02},'_src':{'type':'inference'}}]
        self.assertEqual(self.run_build()['features'],3)
        del self.value['features'][0]['_src']
        with self.assertRaises(Rejected):self.run_build()

    def test_self_intersecting_star_ground_rejected(self):
        import math
        pentagon=[[math.cos(i*2*math.pi/5),math.sin(i*2*math.pi/5)] for i in range(5)]
        self.value['features']=[{'id':'star','kind':'ground_inset','at':[0,0,0],'tone':'trial','_src':{'type':'inference'},
                                'parameters':{'ring':[pentagon[i] for i in (0,2,4,1,3)],'thickness':.01}}]
        with self.assertRaises(Rejected):self.run_build()


if __name__=='__main__':unittest.main()
