import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, PngImagePlugin

from accept import Rejected
import overlap


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.rng=np.random.default_rng(22)
        self.points=np.array([(x,y) for x in np.linspace(80,450,8) for y in np.linspace(80,450,8)],np.float32)
        self.des=self.rng.random((len(self.points),128),dtype=np.float32)
        self.H=np.array([[.9,.1,20],[.05,1.1,10],[.0001,.0002,1]])

    def photo(self,points,name):
        return dict(name=name,im=np.zeros((600,600,3),np.uint8),
                    kp=[cv2.KeyPoint(float(x),float(y),4) for x,y in points],des=self.des)

    def warp(self,p):
        return cv2.perspectiveTransform(np.asarray(p,np.float32)[:,None,:],self.H)[:,0,:]

    def test_known_plane_and_supported_region(self):
        q=self.warp(self.points)
        result=overlap.analyze(self.photo(self.points,'a'),self.photo(q,'b'))
        self.assertTrue(result['candidate'])
        self.assertEqual(result['homography_inliers'],len(self.points))
        self.assertEqual(result['status'],'REVIEW_CANDIDATE')
        self.assertTrue(result['manual_landmark_confirmation_required'])
        self.assertLess(max(overlap.errors(self.H,self.points,q)),.001)
        self.assertGreater(result['spread'][0]['hull_fraction'],.3)
        self.assertEqual(len(result['spread'][0]['bbox_normalized']),2)

    def test_random_false_correspondences_rejected(self):
        q=self.rng.uniform(40,550,self.points.shape).astype(np.float32)
        result=overlap.analyze(self.photo(self.points,'a'),self.photo(q,'b'))
        self.assertFalse(result['candidate'])
        self.assertLess(result['homography_inliers'],20)

    def test_collinear_and_singular_support_rejected(self):
        line=np.array([[100+5*i,100+3*i] for i in range(len(self.points))],np.float32)
        result=overlap.analyze(self.photo(line,'a'),self.photo(line+[20,30],'b'))
        self.assertFalse(result['candidate'])
        self.assertLess(overlap.spread(line,(600,600))['eigen_ratio'],.02)
        self.assertTrue(np.isinf(overlap.errors(np.zeros((3,3)),line,line)).all())
        json.dumps(result,allow_nan=False)

    def test_coherent_wrong_shift_documents_repeated_feature_limit(self):
        # Simulate descriptors that confidently select the next repeated feature.
        wrong=self.warp(self.points+[45,0])
        result=overlap.analyze(self.photo(self.points,'a'),self.photo(wrong,'b'))
        self.assertTrue(result['candidate'])  # Geometry alone cannot discover this false assignment.
        self.assertTrue(result['manual_landmark_confirmation_required'])
        self.assertTrue(any('coherent wrong plane' in text for text in overlap.LIMITS))

    def test_empty_or_single_feature_is_insufficient(self):
        for count in [0,1]:
            a=self.photo(self.points[:count],'a'); b=self.photo(self.points[:count],'b')
            a['des']=None if not count else self.des[:count]; b['des']=a['des']
            result=overlap.analyze(a,b)
            self.assertFalse(result['candidate'])
            self.assertEqual(result['unique_matches'],0)
            json.dumps(result,allow_nan=False)


class InputTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name,color in [('first','red'),('second','blue')]:
            Image.new('RGB',(40,30),color).save(self.root/(name+'.png'))
        self.rows=[dict(id='view-a',file='first.png'),dict(id='view-b',file='second.png')]
        self.plan=self.root/'plan.json'

    def write_plan(self,rows=None):
        self.plan.write_text(json.dumps({'views':self.rows if rows is None else rows}))
        return self.plan

    def test_arbitrary_plan_no_review_gps_or_building_required(self):
        result=overlap.discover(self.write_plan(),self.root/'result')
        self.assertEqual(len(result['pairs']),1)
        self.assertEqual(result['runtime']['threads'],1)
        self.assertFalse(result['runtime']['opencl'])
        self.assertFalse(result['pairs'][0]['candidate'])
        self.assertEqual(result['images'][0]['location'],'unknown')
        self.assertEqual(result['images'][0]['sha256'],hashlib.sha256((self.root/'first.png').read_bytes()).hexdigest())
        self.assertEqual(result['plan']['sha256'],hashlib.sha256(self.plan.read_bytes()).hexdigest())
        with Image.open(self.root/'result/match-sheet.jpg') as image:
            self.assertFalse(image.getexif())
        self.assertTrue((self.root/'result/results.json').exists())
        with self.assertRaises(Rejected): overlap.discover(self.plan,self.root/'result')

    def test_large_empty_duplicate_and_invalid_plans(self):
        cases=[[],self.rows[:1],self.rows*7,
               [self.rows[0],dict(id='view-a',file='second.png')],
               [self.rows[0],dict(id='view-b',file='first.png')],
               [self.rows[0],dict(id='bad\nlabel',file='second.png')],
               [self.rows[0],dict(id='view-b',file='missing.png')],
               [self.rows[0],dict(id='view-b',file=12)],
               [self.rows[0],None]]
        for rows in cases:
            with self.subTest(rows=rows),self.assertRaises(Rejected): overlap.load_plan(self.write_plan(rows))
        self.plan.write_text('{oops')
        with self.assertRaises(Rejected): overlap.load_plan(self.plan)

    def test_duplicate_bytes_pixels_and_symlink_paths(self):
        a,b=self.root/'first.png',self.root/'second.png'
        b.write_bytes(a.read_bytes())
        with self.assertRaisesRegex(Rejected,'duplicate source'): overlap.discover(self.write_plan(),self.root/'out')
        info=PngImagePlugin.PngInfo();info.add_text('description','different metadata, same pixels')
        Image.open(a).save(b,pnginfo=info)
        self.assertNotEqual(a.read_bytes(),b.read_bytes())
        with self.assertRaisesRegex(Rejected,'duplicate source'): overlap.discover(self.write_plan(),self.root/'out')
        b.unlink();b.symlink_to(a)
        with self.assertRaisesRegex(Rejected,'resolved image path'): overlap.load_plan(self.write_plan())

    def test_public_output_and_invalid_decode_rejected(self):
        repo=self.root/'repo';repo.mkdir();(repo/'.git').mkdir()
        with self.assertRaisesRegex(Rejected,'outside Git'): overlap.discover(self.write_plan(),repo/'output')
        (self.root/'second.png').write_bytes(b'not an image')
        with self.assertRaises(Rejected): overlap.discover(self.write_plan(),self.root/'out')
        self.assertFalse((self.root/'out').exists())

    def test_explicit_orientation_matches_opencv_default(self):
        pixels=np.random.default_rng(8).integers(0,256,(30,40,3),dtype=np.uint8)
        path=self.root/'oriented.jpg'
        for orientation in range(1,9):
            with self.subTest(orientation=orientation):
                exif=Image.Exif();exif[274]=orientation
                Image.fromarray(pixels).save(path,exif=exif)
                photo=overlap.load_view(dict(id='oriented',file=path))
                np.testing.assert_array_equal(photo['im'],cv2.imread(str(path)))
                self.assertEqual(photo['record']['exif_orientation_applied'],orientation)
                self.assertEqual(photo['record']['stored_wh'],[40,30])

    def test_transparency_and_pixel_bound_rejected(self):
        path=self.root/'alpha.png';Image.new('RGBA',(20,20)).save(path)
        with self.assertRaises(Rejected): overlap.load_view(dict(id='alpha',file=path))
        narrow=self.root/'narrow.png';Image.new('RGB',(8000,1)).save(narrow)
        with self.assertRaises(Rejected): overlap.load_view(dict(id='narrow',file=narrow))
        with patch.object(overlap,'MAX_PIXELS',100),self.assertRaises(Rejected):
            overlap.load_view(dict(id='large',file=self.root/'first.png'))


if __name__=='__main__': unittest.main()
